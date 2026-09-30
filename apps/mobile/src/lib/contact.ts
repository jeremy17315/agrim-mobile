import { COMPANY } from '@agrim/contracts';
import { Linking } from 'react-native';

/**
 * Ouvre l'application téléphonique avec le contact officiel AGRIM.
 *
 * Le numéro vient du contrat partagé : aucun écran ne doit dupliquer un numéro
 * de support, au risque d'appeler une mauvaise ligne après une mise à jour.
 */
export function callCompany(): Promise<void> {
  const phone = COMPANY.phone.replace(/[\s.-]/g, '');
  return Linking.openURL(`tel:${phone}`);
}
