import Constants from 'expo-constants';

/**
 * Les URL de photos viennent du catalogue du site. L'API les rend normalement
 * absolues, mais le cache hors ligne peut contenir une ancienne URL relative.
 * Cette seconde résolution côté mobile évite qu'une photo valide du site soit
 * remplacée par le pictogramme générique après une mise à jour de l'API.
 */
const DEFAULT_SITE_URL = 'https://agrimsarl.ci';

function siteUrl(): string {
  const fromConfig = Constants.expoConfig?.extra?.['siteUrl'];
  const fromEnv = process.env.EXPO_PUBLIC_SITE_URL;
  const value =
    typeof fromConfig === 'string' && fromConfig.length > 0
      ? fromConfig
      : fromEnv || DEFAULT_SITE_URL;
  return value.replace(/\/+$/, '');
}

/**
 * Convertit une URL de média fournie par le site en URL utilisable par
 * React Native. Les URL absolues restent intactes; les chemins `/media/...`,
 * `media/...` et `//domaine/...` restent tous affichables.
 */
export function resolveProductImageUrl(
  raw: string | null | undefined,
): string | null {
  const value = raw?.trim();
  if (!value) return null;

  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('//')) return `https:${value}`;

  try {
    return new URL(value, `${siteUrl()}/`).toString();
  } catch {
    // Une valeur invalide ne doit jamais casser la carte ou la fiche produit.
    return null;
  }
}
