-- Validation de livraison par OTP.
--
-- Remplace la preuve signature/photo par un code à quatre chiffres remis par
-- le client et vérifié par le backend. Le livreur ne peut plus clôturer une
-- course lui-même.

-- 1) Nouveau type de notification : envoi du code au client.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DELIVERY_OTP';

-- 2) Statuts de livraison. PICKED_UP disparaît ; ARRIVED et OTP_VERIFIED
--    apparaissent. Les courses déjà en cours de retrait sont considérées comme
--    en transit : c'est l'état le plus proche, et il ne fait pas reculer la
--    commande associée.
ALTER TYPE "DeliveryStatus" RENAME TO "DeliveryStatus_old";

CREATE TYPE "DeliveryStatus" AS ENUM (
  'UNASSIGNED',
  'ASSIGNED',
  'ACCEPTED',
  'IN_TRANSIT',
  'ARRIVED',
  'OTP_VERIFIED',
  'DELIVERED',
  'FAILED'
);

ALTER TABLE "Delivery" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "Delivery"
  ALTER COLUMN "status" TYPE "DeliveryStatus"
  USING (
    CASE "status"::text
      WHEN 'PICKED_UP' THEN 'IN_TRANSIT'
      ELSE "status"::text
    END
  )::"DeliveryStatus";

ALTER TABLE "Delivery" ALTER COLUMN "status" SET DEFAULT 'UNASSIGNED';

DROP TYPE "DeliveryStatus_old";

-- 3) Colonnes de preuve retirées. La signature manuscrite et la photo ne sont
--    plus collectées : conserver ces colonnes reviendrait à garder des données
--    personnelles devenues sans usage.
ALTER TABLE "Delivery"
  DROP COLUMN IF EXISTS "proofMethods",
  DROP COLUMN IF EXISTS "proofSignatureFile",
  DROP COLUMN IF EXISTS "proofPhotoFile",
  DROP COLUMN IF EXISTS "proofReceivedBy",
  DROP COLUMN IF EXISTS "proofNote",
  DROP COLUMN IF EXISTS "proofLatitude",
  DROP COLUMN IF EXISTS "proofLongitude",
  DROP COLUMN IF EXISTS "proofSubmittedAt";

DROP TYPE IF EXISTS "DeliveryProofMethod";

-- 4) Horodatages alignés sur le nouveau flux.
ALTER TABLE "Delivery" RENAME COLUMN "pickedUpAt" TO "inTransitAt";

ALTER TABLE "Delivery"
  ADD COLUMN "arrivedAt" TIMESTAMP(3),
  ADD COLUMN "otpVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "otpLatitude" DOUBLE PRECISION,
  ADD COLUMN "otpLongitude" DOUBLE PRECISION;

-- 5) Codes de validation. Seule l'empreinte du code est stockée.
CREATE TABLE "DeliveryOtp" (
  "id" UUID NOT NULL,
  "deliveryId" UUID NOT NULL,
  "codeHash" VARCHAR(64) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "verifiedAt" TIMESTAMP(3),
  "invalidatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DeliveryOtp_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeliveryOtp_deliveryId_createdAt_idx"
  ON "DeliveryOtp"("deliveryId", "createdAt");

ALTER TABLE "DeliveryOtp"
  ADD CONSTRAINT "DeliveryOtp_deliveryId_fkey"
  FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
