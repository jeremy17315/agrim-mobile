-- ═══════════════════════════════════════════════════════════════════════════
-- QR MARCHAND des moyens de paiement — 16 octobre 2026
--
-- Objet : le client qui paie par transfert direct doit pouvoir SCANNER le
-- compte marchand (MTN MoMo, Orange Money, Wave) au lieu de recopier un
-- numéro à onze chiffres. L'application ne fabrique aucun QR : elle réaffiche
-- le contenu EXACT du QR remis par l'opérateur, publié ici par AGRIM.
--
-- Décision : ce contenu vit sur `payment_method_configs`, à côté du numéro de
-- réception — jamais dans le bundle mobile. AGRIM le corrige sans nouvelle
-- version de l'application, et un QR non publié (NULL) reste invisible.
--
-- ⚠️ Migration STRICTEMENT ADDITIVE : une colonne NULLable, aucun verrou long ;
--    les moyens de paiement existants n'ont simplement aucun QR publié.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "payment_method_configs"
  ADD COLUMN IF NOT EXISTS "qrPayload" VARCHAR(1000);
