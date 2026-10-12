import { Redirect } from 'expo-router';

/**
 * L'écran « Commencer » a été retiré du parcours : le catalogue est l'accueil.
 *
 * Cette route reste en place pour que les liens existants (et l'URL racine)
 * ne tombent pas sur une page vide : elle renvoie immédiatement au catalogue,
 * sans rendu intermédiaire visible.
 */
export default function IndexRedirect() {
  return <Redirect href="/catalogue" />;
}
