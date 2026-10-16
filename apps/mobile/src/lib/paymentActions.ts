import { Linking, Platform } from 'react-native';

/**
 * « Payer depuis ce téléphone ».
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * La question qui a créé ce fichier : *comment scanner un QR affiché sur mon
 * téléphone, si je n'ai qu'un seul téléphone ?* Réponse : on ne peut pas. Un
 * QR à l'écran ne se scanne que depuis un AUTRE appareil.
 *
 * D'où deux gestes, qui eux fonctionnent sur un seul téléphone — et que
 * l'application n'offre que si AGRIM les a publiés :
 *
 *  - **ouvrir le lien de paiement** de l'opérateur (Wave, et de plus en plus
 *    d'opérateurs) : l'application passe le relais à l'application de
 *    l'opérateur ou au navigateur, où le client paie ;
 *  - **composer le code USSD** du compte marchand : le téléphone ouvre son
 *    composeur avec le code déjà écrit.
 *
 * Rien n'est fabriqué ici : sans lien publié, aucun bouton ; sans code publié,
 * aucun code. Le QR reste affiché, mais pour ce qu'il est : un moyen de payer
 * depuis un autre écran (ou en montrant son téléphone à quelqu'un).
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Le téléphone peut-il ouvrir un code USSD ?
 *
 * **iOS refuse** : Apple bloque les codes `#…#` pour empêcher les
 * abonnements surfacturés. Proposer le bouton sur iPhone promettrait un geste
 * qui échoue — on ne l'affiche donc que sur Android, et l'écran dit le reste.
 */
export function canDialUssd(platform: string = Platform.OS): boolean {
  return platform === 'android';
}

/**
 * Ouvre un lien publié par AGRIM.
 *
 * Rend `false` plutôt que de propager l'erreur : « aucune application ne
 * répond » est un cas normal (téléphone sans l'application de l'opérateur,
 * pas de navigateur), et l'écran doit alors proposer l'autre voie au lieu
 * d'afficher un écran rouge.
 */
export async function openPublishedLink(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
