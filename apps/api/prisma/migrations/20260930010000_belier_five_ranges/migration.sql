-- Le catalogue commercial Bélier d’Or comporte cinq gammes : Royal Grains,
-- Djassa, Ébène d’Or, Riz violet et Riz noir.
--
-- Les anciennes gammes sont conservées avec leurs commandes historiques mais
-- retirées immédiatement du rayon. CatalogSync créera ou renommera ensuite
-- les gammes actuelles depuis le site, source de vérité des prix et formats.
UPDATE "Product"
SET "isActive" = false
WHERE "slug" IN (
  'sika',
  'dietetique',
  'dietetique-complet',
  'dietetique-violet'
)
  AND "isActive" = true;
