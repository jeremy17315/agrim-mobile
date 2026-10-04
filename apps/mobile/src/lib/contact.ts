import { COMPANY } from '@agrim/contracts';
import { Linking } from 'react-native';

/**
 * Ouvre l'application téléphonique avec le standard fixe officiel AGRIM.
 *
 * Le numéro vient du contrat partagé : aucun écran ne doit dupliquer un numéro
 * de support, au risque d'appeler une mauvaise ligne après une mise à jour.
 */
function call(phone: string): Promise<void> {
  return Linking.openURL(`tel:${phone.replace(/[\s.-]/g, '')}`);
}

/** Standard fixe, affiché depuis les écrans de contact. */
export function callCompany(): Promise<void> {
  return call(COMPANY.landlinePhone);
}

/** Ligne mobile demandée pour le secours immédiat sans Internet. */
export function callMobileSupport(): Promise<void> {
  return call(COMPANY.phone);
}
