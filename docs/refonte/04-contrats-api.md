# Livrable 5 — Contrats d'API v1 `/api/v1`

> Une seule API pour les trois clients (Flutter, site web, back-office).
> Le socle repose sur les conventions **déjà en production** dans ce dépôt
> (enveloppe d'erreurs, pagination, entiers XOF) — elles sont figées ici et
> étendues aux domaines absorbés du site. Référence exécutable : Swagger
> généré depuis les contrôleurs (déjà en place, activé hors production) ;
> la spec OpenAPI exportée sert au back-office et à la génération du client
> Dart Flutter.

---

## 1. Conventions générales

| Sujet | Règle |
| --- | --- |
| Base | `https://api.<domaine>/api/v1` — le préfixe `/api/v1` est global ; **toute rupture de contrat ⇒ `/api/v2`**, jamais de modification silencieuse |
| Format | JSON uniquement, UTF-8. Dates ISO 8601 UTC (`Z`) |
| Montants | **entiers XOF** sans décimale ; poids en grammes entiers ; aucun flottant nulle part |
| Authentification | `Authorization: Bearer <access JWT>` (15 min) ; `POST /auth/refresh` avec rotation et révocation. Le refresh token n'est **jamais** envoyé à autre chose que `/auth/refresh` |
| Idempotence | En-tête **`Idempotency-Key: <uuid>`** obligatoire sur `POST /orders`, initiations de paiement, et déclenchement de jobs. Conservation 7 jours (table `IdempotencyRecord`) |
| Pagination | `?page=1&limit=20` (plafond 100) → `{ "data": [...], "pagination": { "page", "limit", "total" } }` |
| Langue des messages | `message` en français (destiné à l'humain) ; `code` stable en anglais (destiné au programme) |
| RBAC | Chaque route porte ses rôles serveur ; un rôle insuffisant = `403 FORBIDDEN_ROLE` — l'UI ne fait jamais autorisation |
| Rate limiting | Global 120 req/min/IP ; routes sensibles (login, OTP, reset) plafonnées plus bas ; `429` standard |
| Traçabilité | Chaque réponse d'erreur peut inclure `details` ; les 5xx **ne renvoient jamais** de pile technique |

### Enveloppe d'erreur unique (héritée, figée)

```json
{
  "statusCode": 409,
  "code": "INSUFFICIENT_STOCK",
  "message": "Le stock disponible ne couvre plus votre panier.",
  "details": [{ "variantId": "…", "productName": "Sac 5 kg", "available": 3 }]
}
```

Garantie par le filtre global existant : aucune erreur technique brute
n'atteint le client ; les 5xx sont journalisées avec leur pile côté serveur.

### Codes HTTP (hérités)

| Code | Emploi |
| --- | --- |
| `200`/`201` | succès |
| `400` | requête invalide, référence non vendable |
| `401` | non authentifié, jeton expiré |
| `403` | rôle insuffisant (`FORBIDDEN_ROLE`) |
| `404` | introuvable — **aussi** utilisé pour ne pas confirmer l'existence d'une ressource à un tiers non autorisé |
| `409` | conflit d'état : stock insuffisant, transition interdite, clé d'idempotence réutilisée autrement |
| `422` | validation métier (payload bien formé, règle violée) |
| `429` | quota dépassé |
| `503` | passerelle de paiement injoignable |

---

## 2. Catalogue des endpoints — `/api/v1`

### 2.1 Authentification & compte — `/auth`, `/users`

| Méthode | Chemin | Accès | Notes |
| --- | --- | --- | --- |
| POST | `/auth/register` | public | téléphone (CI) + mot de passe ; + `email` facultatif (login web) ; renvoie access+refresh |
| POST | `/auth/login` | public | par téléphone **ou** e-mail — un seul annuaire web+mobile |
| POST | `/auth/refresh` | public | rotation ; rejeu détecté ⇒ toutes sessions révoquées (`REFRESH_TOKEN_REUSED`) |
| POST | `/auth/logout` | authentifié | révoque le refresh courant |
| GET | `/auth/me` | authentifié | profil + solde de crédits |
| POST | `/auth/change-password`, `/auth/forgot-password`, `/auth/reset-password` | variable | reset plafonné (anti-énumération) |
| POST | `/auth/me/delete` | authentifié | RGPD/IVoire : désactivation + anonymisation |
| GET/POST/PUT/DELETE | `/users` (admin), `/users/:id` | GESTIONNAIRE, ADMIN, DG | administration du personnel et des clients (absorbe `utilisateurs` du site) |
| CRUD | `/addresses`, `/addresses/:id` | propriétaire | adresses GPS + repères |
| POST/GET/DELETE | `/push-tokens` | authentifié | enregistrement des jetons **FCM** (android/ios) |

### 2.2 Catalogue & promotions — `/catalog`

Lecture publique (web + mobile) ; écriture back-office. **C'est le changement
structurel par rapport à l'existant** : l'écriture entre dans l'API centrale,
la copie synchronisée disparaît.

| Méthode | Chemin | Accès | Notes |
| --- | --- | --- | --- |
| GET | `/catalog/categories` | public | gammes actives, `sortOrder` |
| GET | `/catalog/products` | public | filtres `?category=&search=&featured=&page=` ; chaque variante expose `effectivePrice`, `originalBasePrice`, `promotionLabel`, `available` |
| GET | `/catalog/products/:slug` | public | détail + avis agrégés |
| POST/PUT/DELETE | `/catalog/products`, `/catalog/products/:id` | GESTIONNAIRE, ADMIN, DG | produit + variantes ; suppression = désactivation |
| GET/POST/PUT/DELETE | `/catalog/promotions`, `/:id` | GESTIONNAIRE, ADMIN, DG | prix daté par variante ; activation exclusive (index partiel) |
| POST | `/catalog/media` | GESTIONNAIRE, ADMIN, DG | upload visuels → `FileAsset` |

Réponse type (extrait variante) :

```json
{
  "id": "uuid", "sku": "RB-DJA-05", "label": "Sac de 5 kg",
  "weightGrams": 5000,
  "basePrice": 2250,
  "effectivePrice": 1990,
  "promotion": { "label": "Rentrée", "endsAt": "2026-09-30T22:00:00Z" },
  "available": true,
  "stockLeft": 118
}
```

> `effectivePrice` est **déjà calculé** (promo appliquée) : les trois clients
> l'affichent tel quel ; au checkout, le serveur le relit et le fige. La règle
> « rien n'est calculé chez le client » est structurelle.

### 2.3 Stock — `/inventory` (back-office)

| Méthode | Chemin | Accès | Notes |
| --- | --- | --- | --- |
| GET | `/inventory/variants?lowStock=true` | GESTIONNAIRE, ADMIN, DG | état + seuils |
| POST | `/inventory/variants/:id/adjust` | GESTIONNAIRE, ADMIN, DG | `{ type: ENTREE|SORTIE|AJUSTEMENT, quantity, reason }` — `reason` obligatoire si `AJUSTEMENT` ; écrit `StockMovement` dans la même transaction |
| GET | `/inventory/variants/:id/movements?page=` | GESTIONNAIRE, ADMIN, DG | journal complet, du plus récent au plus ancien |

Aucun autre module n'écrit le stock (découplage imposé par `common/stock`).

### 2.4 Panier — `/cart`

| Méthode | Chemin | Accès | Notes |
| --- | --- | --- | --- |
| GET | `/cart` | authentifié | panier serveur avec **re-calcul** des prix effectifs à chaque lecture |
| POST | `/cart/items` | authentifié | `{ variantId, quantity }` ; plafond de quantité = stock disponible |
| PATCH | `/cart/items/:id` | authentifié | modification quantité |
| DELETE | `/cart/items/:id` · DELETE `/cart` | authentifié | ligne / panier |

Le panier local Flutter n'est qu'un **cache de lecture** de ce panier ; la
quantité commande jamais fait foi.

### 2.5 Commandes — `/orders` (le contrat le plus garanti)

| Méthode | Chemin | Accès | Notes |
| --- | --- | --- | --- |
| POST | `/orders` | authentifié | **`Idempotency-Key` obligatoire** ; montants **recalculés serveur** (§ 3) |
| GET | `/orders?page=` | authentifié | les miennes (tous canaux — un client du web voit ici ses commandes web) |
| GET | `/orders/:reference` | authentifié propriétaire ou staff | détail + événements |
| GET | `/orders/:reference/tracking` | authentifié propriétaire | statut, livreur, position si en course |
| POST | `/orders/:reference/cancel` | authentifié propriétaire | seulement `PENDING/CONFIRMED` ; restitution stock arbitrée |
| GET | `/management/orders` | GESTIONNAIRE, ADMIN, DG | files par statut |
| PATCH | `/management/orders/:reference/status` | GESTIONNAIRE, ADMIN, DG | transition validée par machine à états (`INVALID_TRANSITION` 409 sinon) |

#### DTO `POST /orders`

Requête :

```json
{
  "items": [
    { "variantId": "uuid", "quantity": 2 }
  ],
  "addressId": "uuid",
  "deliveryZoneCode": "abidjan",
  "note": "Portail bleu, sonner à l'interphone",
  "useCreditBalance": false
}
```

Réponse `201` :

```json
{
  "reference": "CMD-2026-00042",
  "status": "PENDING",
  "items": [
    { "variantId": "uuid", "productName": "Riz Djassa", "variantLabel": "Sac de 5 kg",
      "unitPrice": 1990, "quantity": 2, "lineTotal": 3980 }
  ],
  "subtotal": 3980,
  "deliveryFee": 3500,
  "creditApplied": 0,
  "total": 7480,
  "payment": { "status": "PENDING" }
}
```

**Garanties (toutes côté serveur, dans UNE transaction)** :

1. Le corps ne contient **aucun montant** : prix effectifs, frais de livraison
   (table de zones), remises de crédit sont relus et calculés par l'API.
2. Stock : `SELECT … FOR UPDATE` (tri par id) puis `UPDATE … WHERE stock >= q`
   — `409 INSUFFICIENT_STOCK` avec détail par ligne, sinon.
3. Référence non vendable ⇒ `400 VARIANT_UNAVAILABLE`.
4. `Idempotency-Key` rejouée à l'identique ⇒ **même réponse** renvoyée ; la
   même clé avec un corps différent ⇒ `409 IDEMPOTENCY_KEY_CONFLICT`.
5. Écritures : commande, lignes figées, `StockMovement`, `OrderEvent`,
   `OutboxEvent(ORDER_CREATED)`, incrément compteur — tout ou rien.

### 2.6 Paiements — `/payments`

| Méthode | Chemin | Accès | Notes |
| --- | --- | --- | --- |
| GET | `/payments/provider` | public | fournisseur actif + configuré (télémétrie client) |
| POST | `/payments/orders/:reference/initiate` | propriétaire | **`Idempotency-Key` obligatoire** ; renvoie `checkoutUrl` |
| GET | `/payments/orders/:reference` | propriétaire | statut, **avec re-vérification opérateur** si en attente |
| POST | `/payments/webhooks/:provider` | public (signature) | webhook CinetPay/PayDunya — livrable 6 |

Réponse d'initiation :

```json
{
  "paymentId": "uuid",
  "providerReference": "AGR-CMD-2026-00042-a1b2",
  "status": "AWAITING_CONFIRMATION",
  "checkoutUrl": "https://checkout.cinetpay.com/…",
  "expiresAt": "2026-09-18T19:30:00Z"
}
```

Le client ne connaît **jamais** le statut final autrement que par cette API —
et l'API ne le sait que du webhook signé re-vérifié ou de la réconciliation.

### 2.7 Livraisons — `/deliveries` (hérité intégralement)

| Méthode | Chemin | Accès |
| --- | --- | --- |
| GET | `/deliveries/mine` | LIVREUR |
| GET | `/deliveries/:id` | LIVREUR (ou staff) |
| PATCH | `/deliveries/:id/status` | LIVREUR |
| POST | `/deliveries/:id/verify-otp` | LIVREUR — `{ "code": "0307" }` (chaîne !) |
| GET | `/deliveries/:id/otp-status` | LIVREUR |
| POST | `/deliveries/locations` | LIVREUR (batch de points rejoués hors ligne) |
| GET/POST | `/deliveries/orders/:reference/otp`, `/otp/resend` | CLIENT propriétaire |
| POST | `/deliveries/orders/:reference/assign` | GESTIONNAIRE, ADMIN, DG |
| POST | `/deliveries/orders/:reference/close` | GESTIONNAIRE, ADMIN (clôture d'exception, motif obligatoire) |

Le code OTP n'est lisible que par le client (chiffré AES-GCM pour relecture).
Aucune route livreur n'y donne accès (livrable 7 pour la machine complète).

### 2.8 Factures — `/invoices` (nouveau, absorbe le site)

| Méthode | Chemin | Accès |
| --- | --- | --- |
| GET | `/invoices?orderId=` | propriétaire ou staff |
| GET | `/invoices/:number/pdf` | propriétaire ou staff (flux authentifié, jamais statique) |

### 2.9 Producteurs, engagement, notifications

| Méthode | Chemin | Accès |
| --- | --- | --- |
| GET/POST/PATCH | `/producers/me/**`, `/producers/me/farms`, `/productions` | PRODUCTEUR |
| POST | `/producers/productions/:id/review` (CONFIRMED/RECEIVED/REJECTED) | GESTIONNAIRE, ADMIN |
| CRUD | `/catalog/products/:slug/reviews` | public (L) / client (É) — 1 avis par couple |
| GET | `/referrals/me` | authentifié — code, filleuls, **historique `CreditTransaction`** |
| GET | `/notifications`, POST `/notifications/:id/read` | authentifié |
| GET | `/analytics/dashboard` | DG, ADMIN |

### 2.10 Back-office unifié — `/backoffice` + `/jobs`

| Méthode | Chemin | Accès | Notes |
| --- | --- | --- | --- |
| GET | `/backoffice/dashboard` | GESTIONNAIRE, ADMIN, DG | files : à préparer, à affecter, stock bas, OTP vs overrides |
| GET | `/backoffice/audit?page=` | ADMIN, DG | journal d'actions unifié |
| POST | `/jobs/:job` | `X-Cron-Secret` | `reconciliation`, `abandoned-carts`, `outbox-drain`, `maintenance` — idempotents, `409 JOB_ALREADY_RUNNING` si chevauchement |
| GET | `/health` | public | sonde Passenger/cPanel |
| GET | `/legal/*` | public | CGV, mentions, confidentialité |

---

## 3. Registre des codes d'erreur métier (stable, versionné)

| `code` | HTTP | Signification | Domaine |
| --- | --- | --- | --- |
| `VALIDATION_FAILED` | 400 | payload hors schéma (détail des champs) | tous |
| `INVALID_CREDENTIALS` | 401 | login/mdp faux | auth |
| `TOKEN_EXPIRED` | 401 | access expiré (le client rafraîchit) | auth |
| `REFRESH_TOKEN_REUSED` | 401 | rotation violée → sessions révoquées | auth |
| `FORBIDDEN_ROLE` | 403 | rôle insuffisant | tous |
| `NOT_FOUND` | 404 | ressource absente ou existence non confirmable | tous |
| `INSUFFICIENT_STOCK` | 409 | stock couvrant introuvable (détail par ligne) | orders |
| `VARIANT_UNAVAILABLE` | 400 | référence retirée de la vente | orders |
| `IDEMPOTENCY_KEY_CONFLICT` | 409 | même clé, corps différent | orders, payments, jobs |
| `INVALID_TRANSITION` | 409 | transition de machine à états interdite | orders, deliveries |
| `ORDER_NOT_CANCELLABLE` | 409 | annulation hors fenêtre | orders |
| `PAYMENT_ALREADY_SETTLED` | 409 | paiement déjà réglé (rejeu initiation) | payments |
| `PAYMENT_GATEWAY_UNAVAILABLE` | 503 | agrégateur injoignable (réessai conseillé) | payments |
| `OTP_INVALID` | 400 | code faux (`attempts` restants dans details) | deliveries |
| `OTP_EXPIRED` | 410 | code périmé (régénération nécessaire) | deliveries |
| `OTP_LOCKED` | 429 | 5 tentatives atteintes | deliveries |
| `OTP_RESEND_THROTTLED` | 429 | renvoi avant délai de 60 s | deliveries |
| `DELIVERY_ALREADY_ASSIGNED` | 409 | course déjà prise par un autre livreur | deliveries |
| `REASON_REQUIRED` | 422 | motif obligatoire (ajustement, clôture d'exception) | inventory, deliveries |
| `JOB_ALREADY_RUNNING` | 409 | verrou d'exclusion mutuelle | jobs |
| `RATE_LIMITED` | 429 | quota dépassé | tous |

Ce registre est **le contrat d'erreur** : un code n'est ni retiré ni changé
de sens dans v1 ; les clients (et les tests Flutter) s'y accrochent.

---

## 4. Idempotence — mécanisme transversal

| Opération | Porteur d'idempotence | Garantie |
| --- | --- | --- |
| `POST /orders` | en-tête `Idempotency-Key` → `Order.idempotencyKey` (unique) + `IdempotencyRecord` | rejeu réseau = même commande, même réponse |
| Initiation paiement | `Idempotency-Key` → une seule transaction opérateur par commande en attente | pas de double encaissement |
| Webhooks | `WebhookEvent(provider, externalId)` unique | webhook rejoué = reconnu, sans effet |
| Jobs cron | `JobRun` (index partiel unique) | chevauchement impossible |
| Consommation OTP / transitions | `UPDATE … WHERE état attendu` | une seule écriture décide |

Règle de restitution : en cas d'échec après effets partiels, la transaction
retourne tout ; la clé reste réutilisable. La réponse figée n'est renvoyée
que pour une clé dont l'effet a abouti.

---

## 5. Versionnage et compatibilité Flutter

- Ajouts **additifs** autorisés dans v1 (nouvelles routes, nouveaux champs
  optionnels) ; jamais de suppression ni de changement de type.
- Le client Dart valide les réponses avec des modèles **tolérants**
  (`json_serializable` + champs inconnus ignorés) — une extension serveur ne
  casse jamais une application publiée.
- La spec OpenAPI est exportée en CI (`/api/v1/docs-json`) ; une divergence
  spec ↔ contrôleurs fait échouer le build.
