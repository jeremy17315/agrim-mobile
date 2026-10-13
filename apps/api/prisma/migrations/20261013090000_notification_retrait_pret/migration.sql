-- ═══════════════════════════════════════════════════════════════════════════
-- Notifications — « commande prête au retrait »
--
-- ⚠️ Migration STRICTEMENT ADDITIVE : une nouvelle valeur d'énumération est
-- ajoutée en fin de type. Aucune donnée, aucune colonne, aucune table touchée.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ORDER_READY_FOR_PICKUP';
