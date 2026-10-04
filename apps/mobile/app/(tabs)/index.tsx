import { Redirect } from 'expo-router';

/**
 * L’application ouvre DIRECTEMENT le catalogue.
 *
 * Un écran d’accueil « COMMENCER » ajoutait un geste sans rien apprendre au
 * client : la promesse (« le bon riz, simplement ») vit déjà dans l’en-tête du
 * catalogue, et le premier produit est à portée de pouce. On redirige donc
 * immédiatement, pour tenir la promesse d’une commande en deux ou trois
 * gestes.
 */
export default function IndexScreen() {
  return <Redirect href="/catalogue" />;
}
