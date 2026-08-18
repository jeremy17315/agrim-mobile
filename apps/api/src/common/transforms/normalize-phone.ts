import { Transform } from 'class-transformer';

/**
 * Retire espaces, points et tirets d'un numéro avant validation.
 *
 * Les utilisateurs saisissent spontanément « 07 00 00 00 01 ». Sans cette
 * normalisation, `@Matches` rejette la saisie en 400 alors que le numéro est
 * valide — le nettoyage effectué plus loin dans le service arrive trop tard.
 *
 * Même règle que `phoneSchema` dans le contrat partagé.
 */
export function NormalizePhone() {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().replace(/[\s.-]/g, '') : value,
  );
}
