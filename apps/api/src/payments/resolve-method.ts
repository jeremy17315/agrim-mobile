import { BadRequestException } from '@nestjs/common';

/**
 * Résolution du moyen de paiement d'une commande.
 *
 * Pourquoi ce fichier séparé, et non une méthode de service : la commande
 * (`OrdersService`, `CheckoutService`) et le paiement (`PaymentsModule`) en ont
 * besoin tous les deux, et `PaymentsModule` importe déjà `OrdersModule`. Une
 * dépendance dans l'autre sens créerait un cycle de modules Nest — donc un
 * démarrage impossible. La règle vit ici, en fonction pure.
 */

/** Codes des opérateurs historiques (agrégateur) → codes de transfert direct. */
export const LEGACY_PROVIDER_TO_CODE: Record<string, string> = {
  ORANGE_MONEY: 'ORANGE_MONEY',
  MTN_MOMO: 'MTN_MOMO',
  MOOV_MONEY: 'MOOV_MONEY',
  WAVE: 'WAVE',
};

export type OrderPaymentMethod = 'CASH_ON_DELIVERY' | 'DIRECT_MOBILE_MONEY';

export interface ResolvedOrderPayment {
  /** Méthode ENREGISTRÉE sur la commande (jamais l'agrégateur). */
  method: OrderPaymentMethod;
  /** Code du moyen de paiement direct, ou `null` (paiement à la livraison). */
  methodCode: string | null;
}

/**
 * Traduit la demande du client en méthode de commande.
 *
 * Règle : **aucune nouvelle commande ne peut naître avec `MOBILE_MONEY`**.
 * Une application déjà installée qui envoie encore `MOBILE_MONEY` + son
 * opérateur est servie par le transfert direct — son intention est respectée,
 * et l'encaissement par agrégateur n'est pas réintroduit.
 */
export function normalizeOrderPayment(input: {
  paymentMethod: string;
  mobileMoneyProvider?: string | null;
  paymentMethodCode?: string | null;
}): ResolvedOrderPayment {
  if (input.paymentMethod === 'CASH_ON_DELIVERY') {
    return { method: 'CASH_ON_DELIVERY', methodCode: null };
  }

  const code = input.paymentMethodCode
    ? input.paymentMethodCode.trim().toUpperCase()
    : null;

  if (input.paymentMethod === 'DIRECT_MOBILE_MONEY') {
    if (!code) {
      throw new BadRequestException({
        code: 'PAYMENT_METHOD_CODE_REQUIRED',
        message: 'Choisissez le moyen de paiement que vous allez utiliser.',
      });
    }
    return { method: 'DIRECT_MOBILE_MONEY', methodCode: code };
  }

  if (input.paymentMethod === 'MOBILE_MONEY') {
    const legacy =
      input.mobileMoneyProvider &&
      LEGACY_PROVIDER_TO_CODE[input.mobileMoneyProvider];
    const resolved = code ?? legacy ?? null;
    if (!resolved) {
      // Même code d'erreur qu'avant la bascule : une application déjà
      // installée sait déjà l'afficher, elle n'a pas à être mise à jour pour
      // comprendre qu'il lui manque un opérateur.
      throw new BadRequestException({
        code: 'PAYMENT_PROVIDER_REQUIRED',
        message: 'Choisissez votre opérateur Mobile Money.',
      });
    }
    return { method: 'DIRECT_MOBILE_MONEY', methodCode: resolved };
  }

  // `CARD` et toute valeur inconnue : on ne devine pas un moyen de paiement.
  throw new BadRequestException({
    code: 'PAYMENT_METHOD_UNSUPPORTED',
    message:
      'Ce moyen de paiement n’est pas proposé. Choisissez le transfert direct ou le paiement à la livraison.',
  });
}

/**
 * Source minimale : le service Prisma ou une transaction Prisma.
 *
 * Déclarée en syntaxe MÉTHODE (et non en propriété-flèche) : c'est ce qui rend
 * le client Prisma généré assignable — sa signature `findFirst<T>` est bivariante
 * vis-à-vis de notre usage, une propriété-flèche serait refusée par TypeScript.
 */
export type MethodSource = {
  paymentMethodConfig: {
    findFirst(args: {
      where: { code: string; isActive: boolean };
      select: { code: true; operatorName: true; receivingNumber: true };
    }): Promise<{
      code: string;
      operatorName: string;
      receivingNumber: string;
    } | null>;
  };
};

/**
 * Vérifie que le moyen choisi est bien ACTIF, et récupère le numéro officiel.
 *
 * Deux raisons de refuser plutôt que de continuer :
 *  - un code inconnu signifie qu'aucun numéro n'a été configuré : on ne peut pas
 *    demander au client de payer vers un numéro qui n'existe pas ;
 *  - un code désactivé signifie qu'AGRIM ne suit plus ce compte. Y envoyer un
 *    transfert, c'est de l'argent perdu pour le client.
 */
export async function resolveOrderPaymentMethod(
  source: MethodSource,
  code: string,
): Promise<{ code: string; operatorName: string; receivingNumber: string }> {
  const method = await source.paymentMethodConfig.findFirst({
    where: { code: code.trim().toUpperCase(), isActive: true },
    select: { code: true, operatorName: true, receivingNumber: true },
  });
  if (!method) {
    throw new BadRequestException({
      code: 'PAYMENT_METHOD_UNAVAILABLE',
      message:
        'Ce moyen de paiement n’est pas disponible. Choisissez-en un autre, ou le paiement à la livraison.',
    });
  }
  return method;
}
