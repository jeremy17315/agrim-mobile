/**
 * Routage du toucher d'une notification. Module pur, sans dépendance native :
 * testable hors de l'application.
 */
/**
 * Route de destination d'une notification touchée. Fonction pure, testée.
 *
 * `target` provient du serveur : `produit`, `offre`, `categorie`, `commande`,
 * `information`. Une commande invitée ouvre la page de confirmation, publique ;
 * une page réservée aux comptes n'est jamais proposée à un client sans compte.
 */
export function pushTargetRoute(data: unknown, loggedIn: boolean): string {
  const d = (data ?? {}) as Record<string, unknown>;
  const value = typeof d.value === 'string' ? d.value.trim() : '';
  const reference = typeof d.reference === 'string' ? d.reference.trim() : '';

  // Ancien format : une référence seule désigne une commande.
  const target = d.target ?? (reference ? 'commande' : undefined);

  switch (target) {
    case 'produit':
      return value ? `/produit/${encodeURIComponent(value)}` : '/catalogue';
    case 'categorie':
      return value
        ? `/catalogue?category=${encodeURIComponent(value)}`
        : '/catalogue';
    case 'offre':
      return '/catalogue';
    case 'commande': {
      const ref = value || reference;
      if (!ref) return loggedIn ? '/notifications' : '/catalogue';
      return loggedIn
        ? `/commandes/${encodeURIComponent(ref)}`
        : `/confirmation/${encodeURIComponent(ref)}`;
    }
    default:
      return loggedIn ? '/notifications' : '/catalogue';
  }
}
