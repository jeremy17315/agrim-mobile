-- Fondations SSOT (refonte AGRIM — voir docs/refonte/).
--
-- Trois familles :
--   1. les tables techniques nouvelles (promotions, outbox, webhooks,
--      idempotence, journal de messagerie, verrous cron) ;
--   2. les contraintes d'intégrité que Prisma ne sait pas exprimer
--      (CHECK et index partiels) — la base elle-même devient gardienne
--      des règles financières ;
--   3. rien n'est renommé ni supprimé : cette migration est purement
--      additive et peut être déployée sans fenêtre.

-- ── 1. Tables nouvelles ──────────────────────────────────────────────

CREATE TABLE "Promotion" (
    "id" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "priceXof" INTEGER NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cron_locks" (
    "job" VARCHAR(60) NOT NULL,
    "lockedAt" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "lastRunStartedAt" TIMESTAMP(3),
    "lastRunFinishedAt" TIMESTAMP(3),
    "lastStatus" VARCHAR(20),
    "lastError" VARCHAR(500),
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cron_locks_pkey" PRIMARY KEY ("job")
);

CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "type" VARCHAR(60) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "lastError" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebhookEvent" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "externalId" VARCHAR(120) NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'RECEIVED',
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IdempotencyRecord" (
    "scope" VARCHAR(60) NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("scope", "key")
);

CREATE TABLE "MessageLog" (
    "id" UUID NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "template" VARCHAR(60),
    "toAddress" VARCHAR(200) NOT NULL,
    "userId" UUID,
    "orderId" UUID,
    "outboxEventId" UUID,
    "providerMessageId" VARCHAR(160),
    "status" VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
    "error" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageLog_pkey" PRIMARY KEY ("id")
);

-- ── 2. Clés étrangères et index ──────────────────────────────────────

ALTER TABLE "Promotion"
  ADD CONSTRAINT "Promotion_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Promotion_variantId_isActive_idx" ON "Promotion"("variantId", "isActive");

-- UN SEUL prix promotionnel actif par variante. La désactivation est
-- explicite ; le back-office ne peut pas créer un état ambigu.
CREATE UNIQUE INDEX "promotion_active_par_variante"
  ON "Promotion"("variantId") WHERE "isActive";

CREATE INDEX "outbox_events_status_availableAt_idx" ON "outbox_events"("status", "availableAt");
CREATE INDEX "outbox_events_type_createdAt_idx" ON "outbox_events"("type", "createdAt");

-- L'IDEMPOTENCE DES WEBHOOKS : un (provider, externalId) n'entre qu'une fois.
-- Le rejeu d'un webhook par l'agrégateur est reconnu, journalisé, sans effet.
CREATE UNIQUE INDEX "WebhookEvent_provider_externalId_key"
  ON "WebhookEvent"("provider", "externalId");
CREATE INDEX "WebhookEvent_provider_receivedAt_idx" ON "WebhookEvent"("provider", "receivedAt");

CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

CREATE INDEX "MessageLog_status_createdAt_idx" ON "MessageLog"("status", "createdAt");
CREATE INDEX "MessageLog_outboxEventId_idx" ON "MessageLog"("outboxEventId");
CREATE INDEX "MessageLog_userId_createdAt_idx" ON "MessageLog"("userId", "createdAt");

-- ── 3. Contraintes d'intégrité financières (la base fait respecter) ──

-- ANTI DOUBLE-VENTE : un stock négatif est impossible, même sous bug
-- applicatif. Le décrément conditionnel reste la voie normale ; ce CHECK
-- est la dernière ligne de défense.
ALTER TABLE "ProductVariant"
  ADD CONSTRAINT "stock_non_negatif" CHECK ("stock" >= 0);

-- Un mouvement de stock nul n'est pas un mouvement.
ALTER TABLE "StockMovement"
  ADD CONSTRAINT "stock_mouvement_non_nul" CHECK ("quantity" <> 0);

-- Cohérence comptable des lignes : figée à la création, recalculée nulle part.
ALTER TABLE "OrderItem"
  ADD CONSTRAINT "order_item_ligne_positive"
  CHECK ("quantity" > 0 AND "lineTotal" = "unitPrice" * "quantity");

-- NB : pas de CHECK sur Order.total à ce stade — l'application du solde de
-- parrainage rend l'invariant plus riche que total = subtotal + deliveryFee.
-- La contrainte exacte arrive avec l'itération « orders » (docs/refonte).
