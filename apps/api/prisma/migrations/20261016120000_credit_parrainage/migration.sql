-- ═══════════════════════════════════════════════════════════════════════════
-- Crédit de parrainage DÉPENSABLE — 16 octobre 2026
--
-- Objet : le crédit accordé au parrain (`User.creditBalanceXof`, alimenté par
-- `deliveries.service.ts` à la première livraison du filleul) était incrémenté
-- et affiché, mais n'entrait dans AUCUN total : il n'était pas dépensable.
--
-- La commande fige désormais le montant consommé, à qui il appartenait, et
-- s'il a déjà été rendu.
--
-- ⚠️ Migration STRICTEMENT ADDITIVE : trois colonnes, toutes avec une valeur
--    par défaut ou NULL, aucun verrou long (les commandes existantes valent 0
--    et restent lisibles telles quelles).
-- ═══════════════════════════════════════════════════════════════════════════

-- Montant de crédit consommé par la commande. 0 = aucune (toutes les
-- commandes antérieures à cette date).
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "credit" INTEGER NOT NULL DEFAULT 0;

-- Compte dont le crédit a été débité. NULL pour une commande invitée sans
-- compte connecté — il n'y a alors personne à rembourser.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "creditUserId" UUID;

-- Horodatage du remboursement du crédit (annulation). Non NULL = déjà rendu.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "creditRefundedAt" TIMESTAMP(3);
