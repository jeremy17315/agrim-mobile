-- ═══════════════════════════════════════════════════════════════════════════
-- LIEN DE PAIEMENT du compte marchand — 16 octobre 2026
--
-- Objet : « comment payer depuis ce téléphone ? » — un QR affiché sur l'écran
-- ne peut pas être scanné par le téléphone qui l'affiche. Quand l'opérateur
-- fournit un lien de paiement (Wave, et de plus en plus d'opérateurs), le
-- client doit pouvoir l'OUVRIR d'un geste : l'application passe le relais à
-- l'application de l'opérateur ou au navigateur.
--
-- Décision : ce lien vit sur `payment_method_configs`, à côté du numéro et du
-- QR — jamais dans le bundle mobile. AGRIM le corrige sans nouvelle version.
-- Seuls les schémas http, https et tel sont acceptés à l'enregistrement : un
-- schéma inconnu ne doit jamais pouvoir être ouvert par l'application.
--
-- ⚠️ Migration STRICTEMENT ADDITIVE : une colonne NULLable, aucun verrou long ;
--    les comptes existants n'ont simplement aucun lien publié.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "payment_method_configs"
  ADD COLUMN IF NOT EXISTS "paymentUrl" VARCHAR(500);
