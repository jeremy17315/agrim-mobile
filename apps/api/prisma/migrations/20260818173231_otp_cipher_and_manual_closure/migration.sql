-- Chiffrement du code de livraison + clôture d'exception.
--
-- 1) Le code était haché dans DeliveryOtp mais écrit EN CLAIR dans le corps de
--    la notification, où il subsistait après la livraison. Le hachage ne
--    protégeait donc rien. Le code est désormais chiffré (AES-256-GCM) et lu
--    par son propriétaire via une route dédiée ; la notification ne le porte
--    plus.
--
-- 2) Clôture d'exception par le gestionnaire, pour les remises réelles qu'un
--    OTP ne peut pas valider (téléphone déchargé, réception par un tiers).

-- Codes existants : aucun texte chiffré ne peut être reconstitué sans le code
-- d'origine. Les codes encore actifs sont invalidés, les clients en
-- régénéreront un. Préférable à une colonne au contenu incohérent.
UPDATE "DeliveryOtp"
  SET "invalidatedAt" = CURRENT_TIMESTAMP
  WHERE "verifiedAt" IS NULL AND "invalidatedAt" IS NULL;

ALTER TABLE "DeliveryOtp" ADD COLUMN "codeCipher" TEXT NOT NULL DEFAULT '';
ALTER TABLE "DeliveryOtp" ALTER COLUMN "codeCipher" DROP DEFAULT;

-- Purge des codes en clair déjà présents dans les notifications envoyées.
UPDATE "Notification"
  SET "body" = 'Votre code de livraison est disponible dans le suivi de votre commande.'
  WHERE "type" = 'DELIVERY_OTP';

-- Mode de clôture : sans cette trace, impossible de distinguer une livraison
-- validée par le client d'une clôture administrative — et donc de mesurer si
-- l'exception devient la norme.
CREATE TYPE "DeliveryClosureMode" AS ENUM ('CLIENT_OTP', 'MANAGER_OVERRIDE');

ALTER TABLE "Delivery"
  ADD COLUMN "closureMode"   "DeliveryClosureMode",
  ADD COLUMN "closedById"    UUID,
  ADD COLUMN "closureReason" VARCHAR(500);

-- Les livraisons déjà terminées l'ont toutes été par le code du client.
UPDATE "Delivery" SET "closureMode" = 'CLIENT_OTP' WHERE "status" = 'DELIVERED';

ALTER TABLE "Delivery"
  ADD CONSTRAINT "Delivery_closedById_fkey"
  FOREIGN KEY ("closedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Delivery_closureMode_idx" ON "Delivery"("closureMode");
