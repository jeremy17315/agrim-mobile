import { updatePushDevice } from '@/api/notifications';
import { getInstallationId, rememberGuestPhone } from '@/lib/installation';

/**
 * Le numéro qu'un invité vient de saisir devient celui de son appareil.
 *
 * Sans compte, c'est la SEULE façon de le retrouver : le serveur cherche
 * l'appareil par numéro (`notifyPhone`) pour annoncer un paiement confirmé ou
 * un livreur en route. Le numéro est aussi conservé sur l'appareil, pour que
 * l'enregistrement suivant (nouveau jeton, redémarrage) le renvoie.
 *
 * Volontairement séparé du cycle de vie du push (`usePushRegistration`) :
 * l'écran de commande n'a pas besoin de charger le module de notifications
 * pour déclarer un numéro, et cette écriture n'est jamais bloquante — une
 * commande passée doit le rester même si elle échoue.
 */
export async function declareGuestPhone(phone: string): Promise<void> {
  await rememberGuestPhone(phone);
  const installationId = await getInstallationId();
  await updatePushDevice({ installationId, phone });
}
