-- ═══════════════════════════════════════════════════════════════════════════
-- Finalisation AGRIM / BÉLIER D'OR — 11 octobre 2026
--
-- Objet : rendre possible le PAIEMENT DIRECT MANUEL (abandon des
-- agrégateurs), l'administration des codes promo, les notifications poussées
-- sans compte, les campagnes et les points de vente.
--
-- ⚠️ Migration STRICTEMENT ADDITIVE.
--   - aucune colonne supprimée, aucun type retiré : les commandes réglées via
--     l'agrégateur avant cette date restent lisibles et réconciliables ;
--   - les nouvelles valeurs d'énumération sont ajoutées en fin de type ;
--   - les tables créées sont nouvelles, donc sans impact sur le site qui
--     consomme déjà cette base.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────── Énumérations ────────────────────────────────

-- Régime manuel : déclaré par le client, en vérification, rejeté.
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'DECLARED_BY_CUSTOMER';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'UNDER_REVIEW';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

-- Transfert direct vers le numéro officiel d'AGRIM.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'DIRECT_MOBILE_MONEY';

-- Cycle de vie du paiement manuel côté notifications.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PAYMENT_DECLARED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PAYMENT_CONFIRMED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PAYMENT_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PAYMENT_AMOUNT_MISMATCH';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PROMOTION';

CREATE TYPE "PaymentDeclarationStatus" AS ENUM ('DECLARED', 'VERIFYING', 'ACCEPTED', 'REJECTED');
CREATE TYPE "PromoDiscountType" AS ENUM ('PERCENT', 'FIXED');
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'FAILED');
CREATE TYPE "CampaignAudience" AS ENUM ('ALL_OPTED_IN', 'AUTHENTICATED', 'TEST');

-- ─────────────────────────── Paiement ────────────────────────────────────

-- Le moyen de paiement affiché et le numéro vers lequel le client a payé sont
-- recopiés sur le paiement : si AGRIM retire un moyen de paiement, on doit
-- encore pouvoir expliquer une ancienne commande.
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "methodCode" VARCHAR(40);
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "receivingNumber" VARCHAR(30);
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3);

-- Moyens de paiement directs : AUCUNE ligne n'est insérée ici. Un numéro de
-- réception inventé enverrait l'argent des clients ailleurs. La table est
-- remplie par AGRIM dans l'administration (ou par le script d'amorçage
-- documenté dans docs/LIVRAISON-FINALISATION-2026-10-11.md § 4).
CREATE TABLE "payment_method_configs" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "operatorName" VARCHAR(80) NOT NULL,
    "receivingNumber" VARCHAR(30) NOT NULL,
    "beneficiaryName" VARCHAR(120),
    "instructions" VARCHAR(600),
    "ussdTemplate" VARCHAR(200),
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_method_configs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payment_method_configs_code_key" ON "payment_method_configs"("code");

ALTER TABLE "payment_method_configs"
    ADD CONSTRAINT "payment_method_configs_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "payment_declarations" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "transactionReference" VARCHAR(60) NOT NULL,
    -- L'unicité porte sur la forme NORMALISÉE : `tx12ab` et `TX12AB` sont la
    -- même transaction chez l'opérateur, et ne doivent pas pouvoir valider
    -- deux commandes.
    "transactionReferenceNormalized" VARCHAR(60) NOT NULL,
    "declaredAmount" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3),
    "proofKey" VARCHAR(200),
    "proofMimeType" VARCHAR(100),
    "proofSizeBytes" INTEGER,
    "status" "PaymentDeclarationStatus" NOT NULL DEFAULT 'DECLARED',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "rejectionNote" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_declarations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payment_declarations_transactionReferenceNormalized_key"
    ON "payment_declarations"("transactionReferenceNormalized");
CREATE INDEX "payment_declarations_paymentId_idx" ON "payment_declarations"("paymentId");
CREATE INDEX "payment_declarations_status_submittedAt_idx" ON "payment_declarations"("status", "submittedAt");

ALTER TABLE "payment_declarations"
    ADD CONSTRAINT "payment_declarations_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_declarations"
    ADD CONSTRAINT "payment_declarations_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "payment_review_logs" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "action" VARCHAR(30) NOT NULL,
    "fromStatus" VARCHAR(30),
    "toStatus" VARCHAR(30),
    "note" VARCHAR(500),
    "actorId" UUID,
    "actorRole" VARCHAR(20),
    "actorSource" VARCHAR(10) NOT NULL DEFAULT 'SYSTEM',
    "actorIp" VARCHAR(60),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_review_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payment_review_logs_paymentId_createdAt_idx" ON "payment_review_logs"("paymentId", "createdAt");

ALTER TABLE "payment_review_logs"
    ADD CONSTRAINT "payment_review_logs_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- SetNull et non Cascade : supprimer un compte ne doit pas effacer la preuve
-- qu'une décision de caisse a été prise.
ALTER TABLE "payment_review_logs"
    ADD CONSTRAINT "payment_review_logs_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ───────────────────────────── Codes promo ───────────────────────────────

CREATE TABLE "promo_codes" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "description" VARCHAR(200),
    "discountType" "PromoDiscountType" NOT NULL,
    "discountValue" INTEGER NOT NULL,
    "minOrderTotal" INTEGER,
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "maxUsesPerPhone" INTEGER,
    "zone" VARCHAR(40),
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "appliesTo" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");
CREATE INDEX "promo_codes_isActive_startsAt_endsAt_idx" ON "promo_codes"("isActive", "startsAt", "endsAt");

ALTER TABLE "promo_codes"
    ADD CONSTRAINT "promo_codes_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "promo_code_redemptions" (
    "id" UUID NOT NULL,
    "promoCodeId" UUID NOT NULL,
    "orderReference" VARCHAR(20) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "discount" INTEGER NOT NULL,
    "orderTotal" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_code_redemptions_pkey" PRIMARY KEY ("id")
);
-- Un code ne s'applique qu'UNE fois par commande : c'est cette contrainte qui
-- empêche un rejeu réseau de consommer deux fois le quota.
CREATE UNIQUE INDEX "promo_code_redemptions_promoCodeId_orderReference_key"
    ON "promo_code_redemptions"("promoCodeId", "orderReference");
CREATE INDEX "promo_code_redemptions_promoCodeId_phone_idx"
    ON "promo_code_redemptions"("promoCodeId", "phone");

ALTER TABLE "promo_code_redemptions"
    ADD CONSTRAINT "promo_code_redemptions_promoCodeId_fkey"
    FOREIGN KEY ("promoCodeId") REFERENCES "promo_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ────────────────────────── Appareils et campagnes ───────────────────────

CREATE TABLE "push_devices" (
    "id" UUID NOT NULL,
    "installationId" VARCHAR(64) NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "platform" VARCHAR(10) NOT NULL,
    "userId" UUID,
    "phone" VARCHAR(20),
    "promoOptIn" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "appVersion" VARCHAR(30),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_devices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "push_devices_installationId_key" ON "push_devices"("installationId");
CREATE UNIQUE INDEX "push_devices_token_key" ON "push_devices"("token");
CREATE INDEX "push_devices_userId_idx" ON "push_devices"("userId");
CREATE INDEX "push_devices_phone_idx" ON "push_devices"("phone");
CREATE INDEX "push_devices_isActive_promoOptIn_idx" ON "push_devices"("isActive", "promoOptIn");

ALTER TABLE "push_devices"
    ADD CONSTRAINT "push_devices_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "notification_campaigns" (
    "id" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "body" VARCHAR(500) NOT NULL,
    "category" VARCHAR(30) NOT NULL,
    "imageUrl" VARCHAR(500),
    "linkTarget" VARCHAR(30),
    "linkValue" VARCHAR(120),
    "audience" "CampaignAudience" NOT NULL DEFAULT 'ALL_OPTED_IN',
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "sendingAt" TIMESTAMP(3),
    "targetCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "invalidCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" VARCHAR(500),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_campaigns_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "notification_campaigns_status_scheduledAt_idx"
    ON "notification_campaigns"("status", "scheduledAt");

ALTER TABLE "notification_campaigns"
    ADD CONSTRAINT "notification_campaigns_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Destination au tap et rattachement d'une notification à sa campagne.
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "linkTarget" VARCHAR(30);
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "linkValue" VARCHAR(120);
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "campaignId" UUID;
CREATE INDEX IF NOT EXISTS "Notification_campaignId_idx" ON "Notification"("campaignId");
ALTER TABLE "Notification"
    ADD CONSTRAINT "Notification_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "notification_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────── Points de vente ─────────────────────────────

CREATE TABLE "points_of_sale" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "address" VARCHAR(255) NOT NULL,
    "city" VARCHAR(80) NOT NULL,
    "landmark" VARCHAR(200),
    "phone" VARCHAR(30),
    "openingHours" VARCHAR(120),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "supportsPickup" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "points_of_sale_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "points_of_sale_isActive_sortOrder_idx" ON "points_of_sale"("isActive", "sortOrder");
