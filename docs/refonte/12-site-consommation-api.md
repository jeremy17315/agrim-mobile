# 12. Consommation de l'API centrale par le site (itération P2 — en cours)

> Trajectoire (docs/refonte/00 § cible) : le site FastAPI perd son rôle de
> backend autonome — ses 145 routes sont réabsorbées par `/api/v1`, son front
> devient client. Cette itération pose la surface de lecture et le devis
> panier ; la commande web centralisée est l'itération suivante, la bascule
> reste la phase 4 (docs/refonte/08 § 5).

## 1. Ce que le front du site peut consommer DÈS MAINTENANT

Base : `https://<api>/api/v1` · JSON · erreurs normalisées
`{ statusCode, code, message, details? }` — le front branche sur `code`,
jamais sur le texte.

| Endpoint | Auth | Rôle pour le site |
| --- | --- | --- |
| `GET /products` | public | Liste : recherche, filtre catégorie, featured, pagination (`?page=&limit≤100`). Chaque variante porte `price`, `effectivePrice`, `promotion` |
| `GET /products/:slug` | public | Fiche produit (URLs SEO conservées : le slug EST la clé) |
| `GET /categories` | public | Arborescence pour menus et navigation |
| `POST /cart/quote` | public (throttlé) | **Le seul montant autorisé à l'écran** : recalcul serveur intégral |

CORS : `CORS_ORIGINS` (variables d'environnement de l'API) doit lister
l'origine du site — sinon le navigateur bloque les appels front.

## 2. La règle d'or : le client affiche, le serveur calcule

Le front n'envoie QUE des identifiants, des quantités et une ville
(`POST /cart/quote { items: [{variantId, quantity}], city }`). Il reçoit :

```json
{
  "items": [
    { "variantId": "…", "sku": "ATT-1KG", "productName": "Attiéké",
      "variantLabel": "1 kg", "unitPrice": 1990, "quantity": 2,
      "weightGrams": 1000, "stock": 8 }
  ],
  "weightKg": 2, "zone": "abidjan",
  "weightUntilFreeDeliveryKg": 8,
  "subtotal": 3980, "deliveryFee": 1000, "total": 4980, "currency": "XOF"
}
```

- `unitPrice` est le prix EFFECTIF (promotion dans sa fenêtre) — la MÊME
  règle que le checkout facturera (`common/pricing/effective-price.ts`).
  Avant cette itération, les lectures publiques n'exposaient aucun prix
  promotionnel : le site aurait affiché le prix normal pendant que la
  commande partait au prix promo.
- `deliveryFee` vient de la grille officielle (`CompanySetting`,
  modifiable back-office sans redéploiement) — jamais d'un tarif codé en
  dur côté front. Grille absente/corrompue ⇒ `503
  DELIVERY_GRID_UNAVAILABLE` : on ne devine jamais un tarif.
- `stock` est un éCHO (griser les quantités indisponibles) : le devis ne
  réserve rien, n'écrit rien, et ne remplace jamais le checkout — qui
  re-vérifie tout sous verrou. Entre devis et paiement, le prix peut
  changer ; c'est le checkout qui fait foi.
- Article inconnu/retiré du rayon ⇒ `404 VARIANT_NOT_FOUND` : le front
  retire la ligne et affiche le message.

## 3. Corrections portées par l'itération (incohérences pointées, puis réglées)

1. **Deux règles de prix divergeaient** : le checkout vérifiait les dates
   de promotion, la fiche admin appliquait `promotions[0]` SANS relire les
   dates (prix périmé affichable), les lectures publiques n'appliquaient
   rien. Désormais UNE règle (`common/pricing/effective-price.ts`) utilisée
   par les trois chemins, testée seule (de l'argent affiché ET facturé).
2. **Aucun devis serveur n'existait** : le front aurait dû deviner les
   frais. `POST /cart/quote` est né (public, throttlé, idempotent par
   construction).

## 4. Ce qui reste côté site (trajectoire)

- **Transition (actuel)** : le site garde son checkout et CinetPay en
  production ; son front remplace progressivement ses propres lectures par
  `/products`, `/categories`, `/cart/quote`. Le `catalog-sync`
  (`SITE_INTEGRATION_URL`) continue d'armer le stock tant que
  `STOCK_MODE=site`.
- **Itération suivante (P2 bis)** : commandes web via `POST /orders`
  (Idempotency-Key, OTP livraison, la livraison calculée par l'API), puis
  paiements web centralisés.
- **Phase 4 (bascule, docs/refonte/08 § 5)** : `STOCK_MODE=local` ET
  `SITE_INTEGRATION_URL` vidé AU MÊME INSTANT (couplage docs/refonte/10
  § 8) — le site ne possède plus rien, il n'affiche plus que ce que l'API
  lui dit.
