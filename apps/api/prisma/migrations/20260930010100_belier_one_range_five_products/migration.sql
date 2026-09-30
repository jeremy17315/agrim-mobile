-- Bélier d’Or est une unique gamme commerciale, composée de cinq produits :
-- Royal Grains, Djassa, Ébène d’Or, Riz violet et Riz noir.
--
-- Aucun produit ni aucune variante n'est supprimé : les commandes historiques
-- gardent donc leurs clés étrangères. Les produits actifs sont simplement
-- regroupés sous la gamme Bélier d’Or, afin que le catalogue mobile ne les
-- affiche plus comme des catégories distinctes.

INSERT INTO "Category" (
  "id",
  "slug",
  "name",
  "description",
  "sortOrder",
  "sourceCode",
  "createdAt",
  "updatedAt"
)
SELECT
  'd6a5f3c1-0d00-4b11-9000-000000000001'::uuid,
  'belier-dor',
  'Bélier d’Or',
  'Le bon riz local, simplement',
  1,
  'BELIER_DOR',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "Category" WHERE "slug" = 'belier-dor'
);

UPDATE "Category"
SET
  "name" = 'Bélier d’Or',
  "description" = 'Le bon riz local, simplement',
  "sortOrder" = 1,
  "sourceCode" = 'BELIER_DOR',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'belier-dor';

-- Les créations futures par le back office portent elles aussi l'identité
-- commerciale visible dans l'application.
ALTER TABLE "Product"
  ALTER COLUMN "brand" SET DEFAULT 'Bélier d’Or';

-- Conservation des IDs et des variantes existants lors du changement de nom.
UPDATE "Product"
SET
  "slug" = 'riz-violet',
  "name" = 'Riz violet',
  "brand" = 'Bélier d’Or',
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'dietetique-violet'
  AND NOT EXISTS (
    SELECT 1 FROM "Product" WHERE "slug" = 'riz-violet'
  );

UPDATE "Product"
SET
  "slug" = 'riz-noir',
  "name" = 'Riz noir',
  "brand" = 'Bélier d’Or',
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = (
  SELECT "id"
  FROM "Product"
  WHERE "slug" IN ('dietetique', 'dietetique-complet')
  ORDER BY CASE WHEN "slug" = 'dietetique-complet' THEN 0 ELSE 1 END
  LIMIT 1
)
  AND NOT EXISTS (
    SELECT 1 FROM "Product" WHERE "slug" = 'riz-noir'
  );

-- Tous les cinq produits actifs relèvent désormais de la même gamme.
UPDATE "Product"
SET
  "categoryId" = (SELECT "id" FROM "Category" WHERE "slug" = 'belier-dor'),
  "brand" = 'Bélier d’Or',
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" IN (
  'royal-grains',
  'djassa',
  'ebene-dor',
  'riz-violet',
  'riz-noir'
);

-- Même avant la première synchronisation site, le libellé visible doit être
-- celui du produit et non l'ancien nom de catégorie ou de marque.
UPDATE "Product"
SET
  "name" = CASE "slug"
    WHEN 'royal-grains' THEN 'Royal Grains'
    WHEN 'djassa' THEN 'Djassa'
    WHEN 'ebene-dor' THEN 'Ébène d’Or'
    WHEN 'riz-violet' THEN 'Riz violet'
    WHEN 'riz-noir' THEN 'Riz noir'
  END,
  "shortDescription" = CASE "slug"
    WHEN 'royal-grains' THEN 'Riz premium, 100 % long grains'
    WHEN 'djassa' THEN 'Le riz local du quotidien'
    WHEN 'ebene-dor' THEN 'Élégance du goût, 25 % de brisures'
    WHEN 'riz-violet' THEN 'Riz violet Bélier d’Or'
    WHEN 'riz-noir' THEN 'Riz noir Bélier d’Or'
  END,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" IN (
  'royal-grains',
  'djassa',
  'ebene-dor',
  'riz-violet',
  'riz-noir'
);

-- Les doublons historiques ou produits retirés sont seulement masqués.
UPDATE "Product"
SET "isActive" = false
WHERE "slug" IN (
  'sika',
  'dietetique',
  'dietetique-complet',
  'dietetique-violet'
)
  AND "isActive" = true;
