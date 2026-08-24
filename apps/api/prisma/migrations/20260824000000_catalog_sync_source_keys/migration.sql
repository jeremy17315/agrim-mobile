-- Synchronisation du catalogue depuis le SITE (audit de cohérence, août 2026).
--
-- Le site devient la source de vérité du catalogue ; cette base en garde une
-- copie. Ces trois colonnes portent la CLÉ de correspondance entre les deux :
--
--   Category.sourceCode / Product.sourceCode  → code de la gamme  (EBE, SIK…)
--   ProductVariant.sourceRef                  → référence produit (RB-EBE-05)
--
-- Toutes NULLABLES : les lignes existantes restent valides, et une variante
-- créée à la main (hors catalogue du site) continue de vivre sans clé.
-- Aucune donnée n'est modifiée ni supprimée par cette migration.

ALTER TABLE "Category" ADD COLUMN "sourceCode" VARCHAR(16);
ALTER TABLE "Product"  ADD COLUMN "sourceCode" VARCHAR(16);

ALTER TABLE "ProductVariant" ADD COLUMN "sourceRef" VARCHAR(40);
ALTER TABLE "ProductVariant" ADD COLUMN "syncedAt"  TIMESTAMP(3);

-- Index uniques : une gamme du site ne peut correspondre qu'à une catégorie
-- et un produit ici, une référence qu'à une variante. NULL reste autorisé
-- autant de fois que nécessaire (comportement standard de PostgreSQL).
CREATE UNIQUE INDEX "Category_sourceCode_key"       ON "Category"("sourceCode");
CREATE UNIQUE INDEX "Product_sourceCode_key"        ON "Product"("sourceCode");
CREATE UNIQUE INDEX "ProductVariant_sourceRef_key"  ON "ProductVariant"("sourceRef");
