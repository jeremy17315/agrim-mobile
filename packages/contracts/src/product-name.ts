/**
 * Nettoyage des noms de produits — la marque ne fait pas partie du nom.
 *
 * Le back office du site range ses produits sous la marque « Bélier d’Or » et
 * la préfixe parfois au nom (« Bélier d’Or Royal Grains »), parfois la suffixe
 * (« Riz violet Bélier d’Or »). Dans l’application, la marque vit déjà à un
 * seul endroit (l’en-tête du catalogue) : la répéter devant chaque produit
 * alourdirait la liste sans rien apprendre au client.
 *
 * On retire donc la marque, en tête OU en queue, avec ses séparateurs
 * (« - », « : », « · », « | », « – », « — ») et les espaces parasites. Les
 * accents et la casse sont ignorés. Un nom qui SE RÉDUIRAIT à la marque seule
 * est conservé tel quel : mieux vaut un doublon qu’un produit sans nom.
 */

/** « Bélier d’Or » en tête, suivi d’un éventuel séparateur. */
const BRAND_LEADING =
  /^\s*(?:riz\s+)?b[ée]lier\s*d\s*['’]?\s*or\s*(?:[-–—:·|]\s*)?/i;

/** « Bélier d’Or » en queue, précédé d’un éventuel séparateur. */
const BRAND_TRAILING =
  /\s*(?:[-–—:·|]\s*)?(?:riz\s+)?b[ée]lier\s*d\s*['’]?\s*or\s*$/i;

export function cleanProductName(raw: string | null | undefined): string {
  const original = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!original) return '';

  let name = original.replace(BRAND_LEADING, '').trim();
  if (name === original) {
    // La marque n’était pas en tête : elle est peut-être en queue.
    name = original.replace(BRAND_TRAILING, '').trim();
  }

  // Séparateur devenu orphelin après un retrait (« Bélier d’Or - »).
  name = name.replace(/^[-–—:·|]\s*/, '').replace(/\s*[-–—:·|]$/, '').trim();

  return name.length > 0 ? name : original;
}
