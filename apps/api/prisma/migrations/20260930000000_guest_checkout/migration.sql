-- Commande invitée : le client peut acheter sans créer de compte.
--
-- Les deux coordonnées sont figées sur Order : l'équipe de livraison voit
-- toujours le nom et le numéro saisis à la commande, sans dépendre d'un profil
-- réutilisable. Le User technique garde les relations existantes (adresse,
-- paiement, livraison) sans exposer de connexion au client invité.

ALTER TABLE "User"
  ADD COLUMN "isGuest" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Order"
  ADD COLUMN "guestName" VARCHAR(160),
  ADD COLUMN "guestPhone" VARCHAR(20);

CREATE INDEX "User_role_isGuest_idx"
  ON "User"("role", "isGuest");

CREATE INDEX "Order_guestPhone_idx"
  ON "Order"("guestPhone");
