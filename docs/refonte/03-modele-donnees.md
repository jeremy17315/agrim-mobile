# Livrable 4 — Modèle de données cible (ERD PostgreSQL)

> Base : le schéma Prisma existant (25 modèles, 14 migrations) — dont
> l'audit a montré la solidité — **étendu** des domaines absorbés du site
> (promotions, factures, messagerie, journal d'audit) et **amputé** de tout
> ce qui n'existait que pour la synchronisation (`sourceCode`, `sourceRef`,
> `syncedAt`). Un seul schéma, gouverné uniquement par les migrations Prisma.

---

## 1. Conventions

| Convention | Règle |
| --- | --- |
| Clés primaires | `uuid` (v4), générées applicativement |
| Montants | **entiers XOF** (`integer`), jamais de flottant, jamais de décimales |
| Poids / quantités | grammes et unités entiers |
| Temps | `timestamptz` UTC (Prisma `DateTime`) |
| Nommage | tables/colonnes telles que produites par Prisma ; les index et contraintes SQL brutes (partiels, CHECK) sont ajoutés par migrations SQL étiquetées |
| Schéma | migrations Prisma **versionnées = unique gouvernance** (règle déjà en vigueur, conservée) |
| Suppressions | logiques (`isActive`, statuts) pour tout ce que des commandes référencent ; `ON DELETE CASCADE` uniquement vers le bas d'agrégats (items, événements, OTP) |

---

## 2. ERD global

```mermaid
erDiagram
    %% ─── Identité ───
    USER ||--o{ REFRESH_TOKEN : "sessions"
    USER ||--o{ PUSH_TOKEN : "appareils FCM"
    USER ||--o{ ADDRESS : "adresses"
    USER ||--o| CART : "panier"
    USER ||--o{ ORDER : "commande"
    USER ||--o{ NOTIFICATION : "reçoit"
    USER ||--o| PRODUCER : "peut être"
    USER ||--o{ CREDIT_TRANSACTION : "solde"
    USER }o--o| USER : "parrainé par"

    %% ─── Catalogue & stock ───
    CATEGORY ||--o{ PRODUCT : "classe"
    PRODUCT ||--o{ PRODUCT_VARIANT : "décline en formats"
    PRODUCT ||--o{ PRODUCT_REVIEW : "est noté"
    PRODUCT_VARIANT ||--o{ STOCK_MOVEMENT : "journalisé par"
    PRODUCT_VARIANT ||--o{ PROMOTION : "prix effectif"
    PRODUCT_VARIANT ||--o{ CART_ITEM : "mis au panier"
    PRODUCT_VARIANT ||--o{ ORDER_ITEM : "vendu comme"

    %% ─── Commande ───
    CART ||--o{ CART_ITEM : "contient"
    ORDER ||--o{ ORDER_ITEM : "ligne"
    ORDER ||--o{ ORDER_EVENT : "audit"
    ORDER ||--o| PAYMENT : "réglée par"
    ORDER ||--o| DELIVERY : "livrée par"
    ORDER ||--o| INVOICE : "facturée"
    ORDER ||--o{ OUTBOX_EVENT : "émet"

    %% ─── Paiement & webhook ───
    PAYMENT ||--o{ WEBHOOK_EVENT : "confirmé par"

    %% ─── Livraison & OTP ───
    DELIVERY ||--o{ DELIVERY_OTP : "validée par"
    DELIVERY ||--o{ DELIVERY_LOCATION : "tracée par"

    %% ─── Producteurs ───
    PRODUCER ||--o{ FARM : "exploite"
    FARM ||--o{ PRODUCTION : "déclare"

    %% ─── Messagerie & ops ───
    OUTBOX_EVENT ||..o{ MESSAGE_LOG : "déclenche"
    OUTBOX_EVENT ||..o{ NOTIFICATION : "produit"

    USER {
        uuid id PK
        varchar phone UK "identifiant naturel (CI)"
        varchar email UK "login web"
        varchar passwordHash
        enum role "CLIENT..DG"
        boolean isActive
        varchar referralCode UK
        uuid referredById FK
        int creditBalanceXof "solde dénormalisé"
    }
    CATEGORY {
        uuid id PK
        varchar slug UK
        varchar name
        int sortOrder
        boolean isActive "hérite : ex-isActive produit"
    }
    PRODUCT {
        uuid id PK
        uuid categoryId FK
        varchar slug UK
        varchar name
        boolean isActive
        boolean isFeatured
    }
    PRODUCT_VARIANT {
        uuid id PK
        uuid productId FK
        varchar sku UK
        varchar label "ex : sac 25 kg"
        int weightGrams
        int price "XOF de base"
        int stock "CHECK stock >= 0"
        int lowStockThreshold
        boolean isAvailable
    }
    PROMOTION {
        uuid id PK
        uuid variantId FK
        int priceXof "prix promo"
        varchar label "ex : -10 pct fin de saison"
        datetime startsAt
        datetime endsAt
        boolean isActive
    }
    STOCK_MOVEMENT {
        uuid id PK
        uuid variantId FK
        enum type "ENTREE..RETOUR"
        int quantity "signé, jamais 0"
        int stockBefore
        int stockAfter
        varchar reason "obligatoire si AJUSTEMENT"
        varchar reference "n° commande"
        uuid actorId FK
    }
    ORDER {
        uuid id PK
        varchar reference UK "CMD-2026-00001"
        uuid userId FK
        enum status "PENDING..CANCELLED"
        int subtotal
        int deliveryFee
        int total
        uuid addressId FK
        varchar idempotencyKey UK "anti double-clic/réseau"
    }
    ORDER_ITEM {
        uuid id PK
        uuid orderId FK
        uuid variantId FK
        varchar productName "figé (historique)"
        varchar variantLabel "figé"
        int unitPrice "prix effectif au moment T"
        int quantity
        int lineTotal
    }
    PAYMENT {
        uuid id PK
        uuid orderId FK "unique"
        enum method
        enum provider "cinetpay/paydunya"
        enum status "PENDING..REFUNDED"
        int amount
        varchar providerReference
        varchar providerTxId UK_partiel "cpm_trans_id"
        datetime expiresAt
        datetime paidAt
    }
    WEBHOOK_EVENT {
        uuid id PK
        varchar provider
        varchar externalId "UK (provider, externalId)"
        boolean signatureValid
        enum status "RECEIVED PROCESSED IGNORED REJECTED"
        json payload
        datetime receivedAt
    }
    DELIVERY {
        uuid id PK
        uuid orderId FK "unique"
        enum status "UNASSIGNED..DELIVERED FAILED"
        uuid courierId FK "LIVREUR"
        uuid addressId FK
        enum closureMode "CLIENT_OTP ou MANAGER_OVERRIDE"
        uuid closedById FK
        varchar closureReason
        datetime otpVerifiedAt
        float otpLatitude
        float otpLongitude
    }
    DELIVERY_OTP {
        uuid id PK
        uuid deliveryId FK
        varchar codeHash "SHA-256"
        varchar codeCipher "AES-256-GCM (relire le code)"
        datetime expiresAt
        int attempts "max 5"
        datetime verifiedAt
        datetime invalidatedAt
    }
    DELIVERY_LOCATION {
        uuid id PK
        uuid deliveryId FK
        float latitude
        float longitude
        datetime recordedAt "mesure, pas réception"
    }
    INVOICE {
        uuid id PK
        uuid orderId FK "unique"
        varchar number UK "FAC-2026-00001"
        uuid pdfFileId FK
        int totalXof
        datetime issuedAt
    }
    NOTIFICATION {
        uuid id PK
        uuid userId FK
        enum type "ORDER_CONFIRMED..LOW_STOCK"
        varchar title
        varchar body
        boolean isRead
        uuid orderId FK
    }
    OUTBOX_EVENT {
        uuid id PK
        varchar type "ORDER_CONFIRMED, DELIVERY_OTP…"
        json payload
        datetime availableAt
        datetime processedAt "NULL = à traiter"
        int attempts
        varchar lastError
    }
    MESSAGE_LOG {
        uuid id PK
        enum channel "PUSH WHATSAPP SMS EMAIL"
        varchar toAddress
        varchar template
        enum status "QUEUED SENT DELIVERED FAILED"
        uuid userId FK
        uuid orderId FK
        varchar providerMessageId
    }
    CREDIT_TRANSACTION {
        uuid id PK
        uuid userId FK
        enum reason "REFERRAL_BONUS ORDER_SPEND ADJUSTMENT"
        int delta "signé"
        uuid orderId FK
        int balanceAfter
    }
    PRODUCT_REVIEW {
        uuid id PK
        uuid productId FK
        uuid userId FK "UK (productId, userId)"
        int rating "1..5"
        varchar comment
    }
    PRODUCER {
        uuid id PK
        uuid userId FK "unique 1-1"
        varchar displayName
        varchar region
    }
    FARM {
        uuid id PK
        uuid producerId FK
        varchar name
        float areaHectares
        boolean isActive
    }
    PRODUCTION {
        uuid id PK
        uuid farmId FK
        varchar season
        int quantityKg
        int targetKg
        enum status "DECLARED CONFIRMED RECEIVED REJECTED"
    }
    REFRESH_TOKEN {
        uuid id PK
        uuid userId FK
        varchar tokenHash UK
        datetime expiresAt
        datetime revokedAt
    }
    PUSH_TOKEN {
        uuid id PK
        uuid userId FK
        varchar token UK "token FCM"
        varchar platform
    }
    ADDRESS {
        uuid id PK
        uuid userId FK
        varchar label
        varchar city
        varchar commune
        float latitude
        float longitude
        boolean isDefault
    }
    CART {
        uuid id PK
        uuid userId FK "unique"
        datetime lastReminderAt "cron paniers abandonnés"
    }
    CART_ITEM {
        uuid id PK
        uuid cartId FK
        uuid variantId FK "UK (cartId, variantId)"
        int quantity
    }
    ORDER_EVENT {
        uuid id PK
        uuid orderId FK
        enum status
        uuid actorId FK
        varchar comment
    }
    %% ─── Ops ───
    IDEMPOTENCY_RECORD {
        varchar key PK_partiel
        varchar scope "endpoint"
        varchar requestHash
        int responseStatus
        json responseBody
        datetime expiresAt
    }
    JOB_RUN {
        uuid id PK
        varchar job
        enum status
        datetime startedAt
        datetime finishedAt "NULL = actif"
    }
    AUDIT_LOG {
        uuid id PK
        uuid actorId FK
        varchar action
        varchar entityType
        varchar entityId
        json before
        json after
    }
    FILE_ASSET {
        uuid id PK
        varchar key UK
        varchar url
        varchar mimeType
        int sizeBytes
    }
    COMPANY_SETTING {
        uuid id PK
        varchar key UK
        varchar value "JSON : tarifs livraison, etc."
    }
    DOCUMENT_COUNTER {
        varchar scope PK "CMD ou FAC + année"
        int current
    }
```

---

## 3. Détail par domaine

Légende : **[Existant]** = modèle du schéma actuel conservé (définition dans
`apps/api/prisma/schema.prisma`) · **[Modifié]** · **[Nouveau]** (absorption
site / exigences SSOT) · **[Retiré]**.

### 3.1 Identité & comptes

| Table | Statut | Points clés |
| --- | --- | --- |
| `User` | **[Modifié]** | **Un seul annuaire** clients + personnel. `phone` unique (identifiant CI), `email` unique (login web). + `emailVerifiedAt`, `whatsappOptIn`, `locale`, `lastLoginAt`. Parrainage inchangé (`referralCode`, `referredById`, `referralRewardedAt`, `creditBalanceXof`) mais le solde est doublé d'un **registre** (`CreditTransaction`) |
| `RefreshToken` | **[Existant]** | Hashés, rotation, révocation. Purge des expirés par cron `maintenance` |
| `PushToken` | **[Existant]** | Jetons **FCM** (`platform` = android/ios) — remplace les jetons Expo |
| `Address` | **[Existant]** | GPS + repères ivoiriens ; référencée par commandes et livraisons (jamais supprimée physiquement si commandée : `isActive` implicite via non-usage) |

### 3.2 Catalogue, promotions, stock

| Table | Statut | Points clés |
| --- | --- | --- |
| `Category` | **[Modifié]** | **– `sourceCode`** (clé de sync site). Reste la dimension « gamme » |
| `Product` | **[Modifié]** | **– `sourceCode`**. Propriétaire du catalogue (écriture back-office). `isActive`/`isFeatured` |
| `ProductVariant` | **[Modifié]** | **– `sourceRef`, `syncedAt`, `originalPrice`** (le prix barré provient de `Promotion`). `price` = prix de base ; `stock` avec **CHECK ≥ 0** ; `lowStockThreshold` |
| `Promotion` | **[Nouveau]** | Prix promotionnel daté par variante. **Un seul** `isActive` par variante (index partiel unique, § 4). Prix effectif = promo active sinon `price`. Calculé serveur, figé sur `OrderItem.unitPrice` |
| `StockMovement` | **[Existant]** | Journal obligatoire, écrit **dans la même transaction** que la variation ; `stockBefore/After` figés ; `reason` obligatoire sur `AJUSTEMENT` ; `actorId` NULL réservé aux mouvements système |
| `FileAsset` | **[Existant]** | Visuels produits, PDF factures. Lecture des fichiers sensibles authentifiée |

### 3.3 Commandes (web + mobile, un seul pipeline)

| Table | Statut | Points clés |
| --- | --- | --- |
| `Cart` / `CartItem` | **[Modifié]** | + `Cart.lastReminderAt` (cron paniers abandonnés). Le panier mobile est un cache de CE panier serveur |
| `Order` | **[Existant]** | `reference` (série `CMD-AAAA`), montants **figés serveur**, `idempotencyKey` unique, machine à états (livrable 5). Les commandes web arrivent ici — la table `commandes` du site disparaît |
| `OrderItem` | **[Existant]** | Dénormalisation volontaire (nom, libellé, `unitPrice`) : l'historique survit aux changements de catalogue |
| `OrderEvent` | **[Existant]** | Audit de chaque transition (qui, quand, statut) |
| `Invoice` | **[Nouveau]** | 1-1 avec `Order`, série `FAC-AAAA`, PDF via `FileAsset` |
| `DocumentCounter` | **[Nouveau]** | Généralise `OrderCounter` (conservé) : séquences `CMD`/`FAC` par année, incrémentées sous verrou de ligne |

### 3.4 Paiements

| Table | Statut | Points clés |
| --- | --- | --- |
| `Payment` | **[Modifié]** | + `providerTxId` (ex-`cpm_trans_id`), **unique par fournisseur** (index partiel), + `attempts`, `lastCheckedAt` (traçabilité des re-vérifications). Le statut ne change QUE par webhook authentifié re-vérifié ou par réconciliation — jamais par le client |
| `WebhookEvent` | **[Nouveau]** | **Idempotence des webhooks** : `unique(provider, externalId)` ; payload brut conservé ; `signatureValid` ; statut de traitement. Un webhook rejoué par CinetPay est reconnu, journalisé, et sans effet |

### 3.5 Livraison & OTP

| Table | Statut | Points clés |
| --- | --- | --- |
| `Delivery` | **[Existant]** | Machine à états `UNASSIGNED → … → DELIVERED/FAILED`, `closureMode` mesuré (`CLIENT_OTP` vs `MANAGER_OVERRIDE`), horodatages par étape, GPS de clôture |
| `DeliveryOtp` | **[Modifié]** | Définition inchangée (SHA-256 + AES-256-GCM, TTL 60 min, 5 essais, usage unique, régénération invalide l'ancien). **+ index partiel unique** : un seul OTP actif par livraison (§ 4) |
| `DeliveryLocation` | **[Existant]** | Dédupliqué (`deliveryId, recordedAt`), purgé après livraison (rétention) |

### 3.6 Producteurs & engagement

| Table | Statut | Points clés |
| --- | --- | --- |
| `Producer` / `Farm` / `Production` | **[Existant]** | Cycle `DECLARED → CONFIRMED → RECEIVED/REJECTED` (le producteur ne valide jamais sa propre récolte) |
| `ProductReview` | **[Existant]** | 1 avis par couple (client, produit), modification = écrasement |
| `ReferralLedger` → `CreditTransaction` | **[Nouveau]** | Chaque variation du solde de parrainage est une ligne signée avec `balanceAfter` — le solde `creditBalanceXof` devient vérifiable ligne à ligne |

### 3.7 Diffusion & opérations

| Table | Statut | Points clés |
| --- | --- | --- |
| `Notification` | **[Existant]** | In-app (centre de notifications mobile). Alimentée par l'Outbox |
| `OutboxEvent` | **[Nouveau]** | Événements métier écrits **dans la transaction** de l'effet ; drainé en ligne + par cron ; `attempts`/`lastError` |
| `MessageLog` | **[Nouveau]** | Journal unifié PUSH/WHATSAPP/SMS/EMAIL (absorbe le journal de messagerie du site) : statuts, erreurs agrégateur, `providerMessageId` |
| `AuditLog` | **[Nouveau]** | Journal des actions back-office (absorbe le journal du site) : acteur, action, entité, avant/après |
| `IdempotencyRecord` | **[Nouveau]** | Rejeu des opérations sensibles (`POST /orders`, initiations de paiement, jobs) : clé + empreinte requête + réponse figée + TTL |
| `JobRun` | **[Nouveau]** | Traçabilité et **exclusion mutuelle** des crons : index partiel unique sur `job` actif (§ 4) |
| `CompanySetting` | **[Existant]** | Paramètres sans redéploiement — dont la **grille de livraison** (JSON versionné, modifiable back-office) |
| `OrderCounter` → `DocumentCounter` | **[Modifié]** | Voir 3.3 |

---

## 4. Contraintes critiques (migrations SQL brutes requises)

Ces contraintes ne sont pas exprimables en DSL Prisma ; elles arrivent en
migrations SQL dédiées et sont **testées** (livrable 10) :

```sql
-- 1. ANTI DOUBLE-VENTE : un stock négatif est impossible, même sous bug applicatif.
ALTER TABLE "ProductVariant" ADD CONSTRAINT stock_non_negatif CHECK (stock >= 0);

-- 2. UN SEUL PRIX PROMO ACTIF PAR VARIANTE.
CREATE UNIQUE INDEX une_promotion_active_par_variante
  ON "Promotion" ("variantId") WHERE "isActive";

-- 3. UN SEUL OTP ACTIF PAR LIVRAISON (régénération = invalidation explicite).
CREATE UNIQUE INDEX un_seul_otp_actif_par_livraison
  ON "DeliveryOtp" ("deliveryId")
  WHERE "verifiedAt" IS NULL AND "invalidatedAt" IS NULL;

-- 4. IDEMPOTENCE DES WEBHOOKS CINETPAY/PAYDUNYA : un evenement rejoue est reconnu.
CREATE UNIQUE INDEX webhook_dedup
  ON "WebhookEvent" ("provider", "externalId");

-- 5. REFERENCE FOURNISSEUR UNIQUE PAR PAIEMENT.
CREATE UNIQUE INDEX paiement_tx_fournisseur
  ON "Payment" ("providerReference")
  WHERE "providerReference" IS NOT NULL;

-- 6. EXCLUSION MUTUELLE DES CRONS : un seul run actif par job.
CREATE UNIQUE INDEX un_run_actif_par_job
  ON "JobRun" ("job") WHERE "finishedAt" IS NULL;

-- 7. IDEMPOTENCE METIER : une cle = un effet, par perimetre.
ALTER TABLE "IdempotencyRecord"
  ADD CONSTRAINT idem_unique UNIQUE ("scope", "key");

-- 8. COHERENCE COMPTABLE DES LIGNES.
ALTER TABLE "OrderItem" ADD CONSTRAINT ligne_positive CHECK (quantity > 0 AND lineTotal = unitPrice * quantity);
ALTER TABLE "Order"     ADD CONSTRAINT total_coherent    CHECK (total = subtotal + deliveryFee AND total > 0);
ALTER TABLE "StockMovement" ADD CONSTRAINT mouvement_non_nul CHECK (quantity <> 0);

-- 9. REGISTRE DE CREDITS : le solde derive des lignes.
ALTER TABLE "CreditTransaction" ADD CONSTRAINT delta_non_nul CHECK (delta <> 0);
```

**Verrouillage des écritures concurrentes (rappel du contrat serveur)** :

| Opération | Mécanisme |
| --- | --- |
| Décrément de stock à la commande | `UPDATE … SET stock = stock - q WHERE id = x AND stock >= q` (+ `FOR UPDATE` amont quand plusieurs variantes) |
| Restitution (annulation/expiration) | Transition conditionnelle du statut commande = jeton d'exclusion (pattern P0 existant, conservé) |
| Numérotation (CMD/FAC) | `UPDATE "DocumentCounter" SET current = current + 1 WHERE … RETURNING current` (verrou de ligne) |
| Consommation d'OTP | `UPDATE … SET verifiedAt = now() WHERE id = x AND verifiedAt IS NULL AND attempts < 5` — une seule écriture décide |
| Règlement de paiement | `UPDATE payments SET status = SUCCEEDED WHERE id = x AND status IN ('PENDING','AWAITING_CONFIRMATION')` — webhook et réconciliation ne peuvent pas doubler |
| Cron | `INSERT JobRun` protégé par l'index partiel unique (6) — le second déclencheur est rejeté |

---

## 5. Deltas avec le schéma actuel (résumé d'exécution)

| Action | Objets |
| --- | --- |
| **Conserver tels quels** (17) | User*, Address, RefreshToken, PushToken, Cart*, CartItem, Order, OrderItem, OrderEvent, StockMovement, ProductReview, Delivery, DeliveryOtp, DeliveryLocation, Notification, Producer, Farm, Production, FileAsset, CompanySetting, OrderCounter |
| **Modifier** (7) | User (+champs web), Category (–sourceCode), Product (–sourceCode), ProductVariant (–sourceRef/syncedAt/originalPrice, +CHECK), Cart (+lastReminderAt), Payment (+providerTxId/attempts/lastCheckedAt), DeliveryOtp (+index partiel), OrderCounter (→ DocumentCounter) |
| **Ajouter** (9) | Promotion, Invoice, WebhookEvent, OutboxEvent, MessageLog, AuditLog, IdempotencyRecord, JobRun, CreditTransaction |
| **Supprimer** | colonnes de synchronisation site (sourceCode, sourceRef, syncedAt) ; côté site : `clients`, `commandes`, `lignes_commande`, `produits`, `gammes`, `avis`, `utilisateurs`, `mouvements_stock`, `tournees` (absorbés) |

\* User est compté dans « modifier » pour ses champs additionnels ; les 17
« conserver » incluent les tables au comportement inchangé.

---

## 6. Rétention et volumétrie

| Donnée | Durée de vie | Purge |
| --- | --- | --- |
| `DeliveryLocation` | Après livraison (+ délai court) | Cron `maintenance` (config `TRACKING_CONFIG` existante) |
| `RefreshToken` expirés/révoqués | 30 j | Cron `maintenance` |
| `IdempotencyRecord` | 7 j après complétion | Cron `maintenance` |
| `OutboxEvent` traités | 30 j | Cron `maintenance` |
| `WebhookEvent` | 12 mois (litiges paiement) | Cron `maintenance` |
| `DeliveryOtp` (historique) | Conservé (preuve de remise, litiges) | Politique légale |
| `MessageLog` / `AuditLog` | 24 mois | Cron `maintenance` |

Volumétrie initiale estimée (base existante + absorption site) : quelques
dizaines de Mo — sans risque pour un PostgreSQL mutualisé LWS. Les PDF et
visuels vivent **sur disque** (via `FileAsset`), la base ne garde que les
métadonnées.

---

## 7. liens avec les autres livrables

- Contrats et DTO exposant ce modèle : livrable 5.
- Machine de paiement sur `Payment`/`WebhookEvent` : livrable 6.
- Machine de livraison sur `Delivery`/`DeliveryOtp` : livrable 7.
- Transformation des données du site vers ces tables : livrable 9.
- Preuves par les tests des contraintes ci-dessus : livrable 10.
