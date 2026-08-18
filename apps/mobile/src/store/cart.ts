import {
  amountUntilFreeDelivery,
  computeCartTotals,
  PROVISIONAL_DELIVERY,
  type CartTotals,
  type Product,
  type ProductVariant,
} from '@agrim/contracts';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * PANIER LOCAL-FIRST.
 *
 * Le panier vit sur l'appareil et survit à la fermeture de l'application : en
 * V1 il n'existe aucun endpoint panier côté serveur. C'est volontaire — sur un
 * réseau intermittent, un panier qui exige une requête à chaque « + » est
 * inutilisable.
 *
 * Deux règles structurantes :
 *  - Zustand ne stocke QUE cet état local. Les données serveur (catalogue,
 *    commandes) restent dans TanStack Query.
 *  - Les prix mémorisés ici sont un AFFICHAGE. Au moment de la commande, le
 *    serveur recalcule tout à partir de ses propres tarifs et fait autorité.
 *    C'est ce qui empêche un panier resté ouvert trois jours de figer un
 *    ancien prix.
 */

/**
 * Le rendu web d'Expo Router s'exécute d'abord dans Node, où `window` n'existe
 * pas : AsyncStorage y lève une exception et fait tomber le serveur. On ne
 * persiste donc que dans un vrai environnement client ; côté serveur le panier
 * démarre vide et sera réhydraté dès que la page vit dans le navigateur.
 */
const isClient = typeof window !== 'undefined';

const memoryStorage = {
  getItem: async () => null,
  setItem: async () => undefined,
  removeItem: async () => undefined,
};

const cartStorage = isClient ? AsyncStorage : memoryStorage;

/** Quantité maximale par ligne : garde-fou contre une saisie accidentelle. */
export const MAX_QUANTITY_PER_LINE = 99;

export type CartLineItem = {
  /** Identifiant de ligne = variante : un format donné n'apparaît qu'une fois. */
  variantId: string;
  productId: string;
  productSlug: string;
  productName: string;
  variantLabel: string;
  weightGrams: number;
  /** Prix connu au moment de l'ajout — à revalider côté serveur. */
  unitPrice: number;
  quantity: number;
  /** Stock connu au moment de l'ajout, pour borner les incréments hors ligne. */
  stockAtAdd: number;
  addedAt: string;
};

type CartState = {
  items: CartLineItem[];
  /** Devient vrai une fois le contenu relu depuis le stockage. */
  hydrated: boolean;

  addItem: (
    product: Product,
    variant: ProductVariant,
    quantity?: number,
  ) => void;
  removeItem: (variantId: string) => void;
  setQuantity: (variantId: string, quantity: number) => void;
  increment: (variantId: string) => void;
  decrement: (variantId: string) => void;
  clear: () => void;
};

function clampQuantity(quantity: number, stock: number): number {
  const ceiling = Math.min(
    MAX_QUANTITY_PER_LINE,
    stock > 0 ? stock : MAX_QUANTITY_PER_LINE,
  );
  return Math.max(1, Math.min(Math.trunc(quantity), ceiling));
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      hydrated: false,

      addItem: (product, variant, quantity = 1) =>
        set((state) => {
          const existing = state.items.find((i) => i.variantId === variant.id);

          if (existing) {
            // Même format déjà présent : on cumule au lieu de créer un doublon.
            return {
              items: state.items.map((i) =>
                i.variantId === variant.id
                  ? {
                      ...i,
                      quantity: clampQuantity(
                        i.quantity + quantity,
                        variant.stock,
                      ),
                    }
                  : i,
              ),
            };
          }

          const line: CartLineItem = {
            variantId: variant.id,
            productId: product.id,
            productSlug: product.slug,
            productName: product.name,
            variantLabel: variant.label,
            weightGrams: variant.weightGrams,
            unitPrice: variant.price,
            quantity: clampQuantity(quantity, variant.stock),
            stockAtAdd: variant.stock,
            addedAt: new Date().toISOString(),
          };
          return { items: [...state.items, line] };
        }),

      removeItem: (variantId) =>
        set((state) => ({
          items: state.items.filter((i) => i.variantId !== variantId),
        })),

      setQuantity: (variantId, quantity) =>
        set((state) => {
          // Descendre à zéro équivaut à retirer la ligne : plus naturel que de
          // laisser une ligne à 0 dans le panier.
          if (quantity <= 0) {
            return {
              items: state.items.filter((i) => i.variantId !== variantId),
            };
          }
          return {
            items: state.items.map((i) =>
              i.variantId === variantId
                ? { ...i, quantity: clampQuantity(quantity, i.stockAtAdd) }
                : i,
            ),
          };
        }),

      increment: (variantId) =>
        set((state) => ({
          items: state.items.map((i) =>
            i.variantId === variantId
              ? { ...i, quantity: clampQuantity(i.quantity + 1, i.stockAtAdd) }
              : i,
          ),
        })),

      decrement: (variantId) =>
        set((state) => {
          const line = state.items.find((i) => i.variantId === variantId);
          if (line && line.quantity <= 1) {
            return {
              items: state.items.filter((i) => i.variantId !== variantId),
            };
          }
          return {
            items: state.items.map((i) =>
              i.variantId === variantId
                ? { ...i, quantity: i.quantity - 1 }
                : i,
            ),
          };
        }),

      clear: () => set({ items: [] }),
    }),
    {
      name: 'agrim-cart-v1',
      version: 1,
      // AsyncStorage et non SecureStore : un panier n'est pas un secret, et
      // SecureStore est bien plus limité en taille.
      storage: createJSONStorage(() => cartStorage),
      // Seules les lignes sont persistées ; `hydrated` est un état d'exécution.
      partialize: (state) => ({ items: state.items }),
      onRehydrateStorage: () => () => {
        // Signale la fin de la lecture disque : tant que c'est faux, l'écran
        // affiche un chargement au lieu d'un « panier vide » trompeur.
        useCartStore.setState({ hydrated: true });
      },
    },
  ),
);

/* -------------------------------- Sélecteurs ---------------------------- */

export const DELIVERY_RULES = PROVISIONAL_DELIVERY;

/**
 * Les sélecteurs qui renvoient un OBJET ne doivent jamais être passés
 * directement à `useCartStore` : Zustand compare le résultat par référence, et
 * un objet fraîchement construit à chaque rendu déclenche une boucle infinie
 * de re-rendus. Ces fonctions restent pures (pratiques à tester) et les écrans
 * consomment les hooks mémoïsés ci-dessous.
 */

/** Nombre total d'articles (somme des quantités), pour la pastille d'onglet. */
export function selectItemCount(state: Pick<CartState, 'items'>): number {
  return state.items.reduce((sum, i) => sum + i.quantity, 0);
}

/** Totaux calculés avec l'algorithme PARTAGÉ avec le backend. */
export function selectTotals(state: Pick<CartState, 'items'>): CartTotals {
  return computeCartTotals(
    state.items.map((i) => ({ unitPrice: i.unitPrice, quantity: i.quantity })),
    DELIVERY_RULES,
  );
}

/** Montant restant avant la livraison offerte (0 = seuil atteint). */
export function selectAmountUntilFreeDelivery(
  state: Pick<CartState, 'items'>,
): number {
  return amountUntilFreeDelivery(selectTotals(state).subtotal, DELIVERY_RULES);
}

/* ----------------------------------- Hooks ------------------------------ */

/** Totaux du panier, recalculés uniquement quand les lignes changent. */
export function useCartTotals(): CartTotals {
  const items = useCartStore((s) => s.items);
  return useMemo(() => selectTotals({ items }), [items]);
}

/** Montant restant avant la livraison offerte. */
export function useAmountUntilFreeDelivery(): number {
  const { subtotal } = useCartTotals();
  return useMemo(
    () => amountUntilFreeDelivery(subtotal, DELIVERY_RULES),
    [subtotal],
  );
}

/** Nombre d'articles ; renvoie un nombre, donc comparable par référence. */
export function useCartItemCount(): number {
  return useCartStore(selectItemCount);
}
