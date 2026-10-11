import { COMPANY } from '@agrim/contracts';
import { Linking } from 'react-native';

/**
 * Ouvre l'application téléphonique sur une ligne officielle AGRIM.
 *
 * Le numéro publié vient du SERVEUR (`GET /config/app`) : AGRIM peut le
 * corriger sans nouvelle version sur le Play Store. `COMPANY` ne sert plus que
 * de REPLI quand l'API n'a pas encore répondu — l'écran affiche alors un
 * numéro juste au lieu de rien, et la source reste le serveur.
 *
 * Aucun écran ne doit écrire un numéro en dur : c'est la seule façon d'être sûr
 * qu'appeler le support depuis l'application sonne au bon endroit.
 */

/** Dernières coordonnées reçues du serveur, si elles l'ont déjà été. */
let publishedSupport: { phone?: string | null; landlinePhone?: string | null } =
  {};

/**
 * Mémorise les coordonnées publiées.
 *
 * Appelée par le fournisseur de configuration au chargement : les écrans qui
 * appellent `callMobileSupport()` n'ont ainsi pas besoin de connaître la
 * requête, et le numéro utilisé reste le dernier publié.
 */
export function rememberPublishedSupport(support: {
  phone?: string | null;
  landlinePhone?: string | null;
}): void {
  publishedSupport = support;
}

/** Numéro mobile affiché (celui d'AGRIM, sinon le repli du contrat). */
export function supportPhone(): string {
  return publishedSupport.phone?.trim() || COMPANY.phone;
}

/** Standard fixe affiché. */
export function supportLandline(): string {
  return publishedSupport.landlinePhone?.trim() || COMPANY.landlinePhone;
}

function call(phone: string): Promise<void> {
  return Linking.openURL(`tel:${phone.replace(/[\s.-]/g, '')}`);
}

/** Standard fixe, affiché depuis les écrans de contact. */
export function callCompany(): Promise<void> {
  return call(supportLandline());
}

/** Ligne mobile demandée pour le secours immédiat sans Internet. */
export function callMobileSupport(): Promise<void> {
  return call(supportPhone());
}
