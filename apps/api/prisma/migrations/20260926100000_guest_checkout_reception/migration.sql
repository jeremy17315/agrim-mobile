-- Commande invitée et modes de réception.
-- Le client n'a pas de compte visible : le backend crée un compte technique
-- marqué isGuest afin de conserver les relations existantes sans exposer de JWT.

CREATE TYPE "ReceptionMode" AS ENUM ('HOME_DELIVERY', 'PICKUP_POINT');
CREATE TYPE "DeliveryFeeStatus" AS ENUM ('TO_CONFIRM', 'CONFIRMED');

ALTER TABLE "User"
  ADD COLUMN "isGuest" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "User_isGuest_idx" ON "User"("isGuest");

CREATE TABLE "PickupPoint" (
  "id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "city" VARCHAR(80) NOT NULL,
  "address" VARCHAR(255),
  "phone" VARCHAR(20),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PickupPoint_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PickupPoint_city_isActive_idx" ON "PickupPoint"("city", "isActive");

ALTER TABLE "Order"
  ADD COLUMN "deliveryFeeStatus" "DeliveryFeeStatus" NOT NULL DEFAULT 'CONFIRMED',
  ADD COLUMN "customerName" VARCHAR(160),
  ADD COLUMN "customerPhone" VARCHAR(20),
  ADD COLUMN "receptionMode" "ReceptionMode" NOT NULL DEFAULT 'HOME_DELIVERY',
  ADD COLUMN "city" VARCHAR(80),
  ADD COLUMN "district" VARCHAR(120),
  ADD COLUMN "landmark" VARCHAR(255),
  ADD COLUMN "pickupPointId" UUID;

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_pickupPointId_fkey"
  FOREIGN KEY ("pickupPointId") REFERENCES "PickupPoint"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Order_pickupPointId_idx" ON "Order"("pickupPointId");

-- Les anciennes commandes sont enrichies depuis leur adresse historique.
UPDATE "Order" o
SET "customerName" = CONCAT(u."firstName", ' ', u."lastName"),
    "customerPhone" = u."phone",
    "city" = a."city",
    "district" = a."district",
    "landmark" = a."landmark"
FROM "User" u, "Address" a
WHERE o."userId" = u."id" AND o."addressId" = a."id";
