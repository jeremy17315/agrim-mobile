/**
 * NOTIFICATIONS POUSSÉES — contrat partagé.
 *
 * Deux exigences structurent ce fichier :
 *
 *  1. **Recevoir sans compte.** Un client qui commande en invité doit être
 *     prévenu de la confirmation de son paiement et de l'arrivée de son
 *     livreur. Le jeton est donc rattaché à une INSTALLATION (identifiant
 *     aléatoire conservé sur l'appareil), pas à un compte. Le compte, s'il
 *     existe, est un rattachement FACULTATIF.
 *  2. **Un envoi n'est pas une lecture.** Les compteurs d'une campagne disent
 *     « accepté par le service » et « refusé », jamais « lu ». L'écran
 *     d'administration ne doit pas laisser croire autre chose.
 */


/**
 * Destination d'une notification.
 *
 * Le serveur la valide puis la transmet telle quelle au mobile, qui décide de
 * la route. Une destination inconnue ouvre l'écran des notifications plutôt
 * que de perdre le client sur un écran vide.
 */
export const NOTIFICATION_TARGETS = [
  'produit',
  'offre',
  'categorie',
  'commande',
  'information',
  /** Espace interne : une notification d'équipe ouvre la commande à traiter. */
  'gestion',
] as const;
export type NotificationTarget = (typeof NOTIFICATION_TARGETS)[number];

/** Libellés proposés à la rédaction d'une campagne. */
export const NOTIFICATION_TARGET_LABELS: Record<NotificationTarget, string> = {
  produit: 'Une fiche produit',
  offre: 'Le catalogue (offres en cours)',
  categorie: 'Une catégorie du catalogue',
  commande: 'Une commande du client',
  information: 'La liste des notifications',
  gestion: 'Une commande à traiter (équipe)',
};

/** Ce que `value` doit contenir pour chaque destination. */
export const NOTIFICATION_TARGET_VALUE_HINTS: Record<
  NotificationTarget,
  string
> = {
  produit: 'identifiant du produit (slug)',
  offre: 'aucune valeur',
  categorie: 'identifiant de la catégorie (slug)',
  commande: 'référence de commande, ex. AGR-2026-0042',
  information: 'aucune valeur',
  gestion: 'référence de commande, ex. AGR-2026-0042',
};

export interface NotificationDeepLink {
  target: NotificationTarget;
  /** Valeur associée : slug de produit, référence de commande, clé d'info. */
  value: string;
  /** Paramètre d'action facultatif (ex. `codePromo=BIENVENUE10`). */
  extra?: string;
}

/**
 * Convertit une destination en paramètres de requête transportables.
 *
 * Les charges utiles push sont des dictionnaires de chaînes : on reste sur ce
 * format, sans JSON imbriqué, que certaines plateformes tronquent.
 */
export function deepLinkToData(link: NotificationDeepLink): Record<string, string> {
  const data: Record<string, string> = {
    target: link.target,
    value: link.value,
  };
  if (link.extra) data['extra'] = link.extra;
  return data;
}

/** Lecture inverse, tolérante : une charge utile abîmée ne doit pas planter l'app. */
export function deepLinkFromData(
  data: Record<string, unknown> | undefined,
): NotificationDeepLink | null {
  if (!data) return null;
  const target = data['target'];
  const value = data['value'];
  if (
    typeof target === 'string' &&
    typeof value === 'string' &&
    (NOTIFICATION_TARGETS as readonly string[]).includes(target)
  ) {
    const extra = data['extra'];
    return {
      target: target as NotificationTarget,
      value,
      ...(typeof extra === 'string' && extra.length > 0 ? { extra } : {}),
    };
  }

  // Compatibilité : une notification envoyée AVANT ce contrat ne portait
  // qu'une référence de commande. Un client qui touche une notification encore
  // présente dans le centre de son téléphone doit atterrir sur sa commande, pas
  // sur la liste.
  const reference = data['reference'];
  if (typeof reference === 'string' && reference.length > 0) {
    return { target: 'commande', value: reference };
  }

  return null;
}

/**
 * Route de l'application correspondant à une destination.
 *
 * C'est le SEUL endroit qui traduit « produit:nouveau-riz » en une adresse
 * d'écran : la liste des notifications, le tap sur une notification poussée et
 * l'aperçu d'une campagne utilisent la même fonction. Sans elle, un lien
 * enregistré en base ne mènerait nulle part.
 *
 * `null` signifie « destination inconnue ou inexploitable » : l'appelant ouvre
 * alors la liste des notifications plutôt qu'un écran vide.
 */
export function deepLinkToPath(link: NotificationDeepLink): string | null {
  const value = link.value.trim();

  switch (link.target) {
    case 'produit':
      return value ? `/produit/${encodeURIComponent(value)}` : null;
    case 'categorie':
      return value
        ? `/catalogue?category=${encodeURIComponent(value)}`
        : '/catalogue';
    // Aucun écran ne liste les offres à part : le catalogue est l'endroit où
    // les promotions s'affichent (prix barrés, badge).
    case 'offre':
      return '/catalogue';
    case 'commande':
      return value ? `/commandes/${encodeURIComponent(value)}` : null;
    case 'gestion':
      return value ? `/gestion/${encodeURIComponent(value)}` : null;
    case 'information':
      return '/notifications';
    default:
      return null;
  }
}

/** Route de secours quand la destination est absente ou inconnue. */
export const NOTIFICATION_FALLBACK_PATH = '/notifications';

/* ───────────────────────────── Campagnes ───────────────────────────────── */

/** Catégories proposées à la rédaction d'une campagne. */
export const NOTIFICATION_CATEGORIES = [
  'PROMOTION',
  'NOUVEAU_PRODUIT',
  'PROMO_CODE',
  'INFORMATION',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  PROMOTION: 'Promotion',
  NOUVEAU_PRODUIT: 'Nouveau produit ou format',
  PROMO_CODE: 'Code promo',
  INFORMATION: 'Information importante',
};

export const CAMPAIGN_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'SENDING',
  'SENT',
  'FAILED',
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  DRAFT: 'Brouillon',
  SCHEDULED: 'Programmée',
  SENDING: 'Envoi en cours',
  SENT: 'Envoyée',
  FAILED: 'Échec',
};

/** Public visé. Volontairement peu de choix : un ciblage flou envoie trop. */
export const CAMPAIGN_AUDIENCES = ['ALL_OPTED_IN', 'AUTHENTICATED', 'TEST'] as const;
export type CampaignAudience = (typeof CAMPAIGN_AUDIENCES)[number];

export const CAMPAIGN_AUDIENCE_LABELS: Record<CampaignAudience, string> = {
  ALL_OPTED_IN: 'Tous les appareils (hors désinscrits)',
  AUTHENTICATED: 'Clients disposant d’un compte',
  TEST: 'Appareils de test uniquement',
};

/** Bornes de rédaction, appliquées par le formulaire ET par le serveur. */
export const CAMPAIGN_LIMITS = {
  titleMin: 3,
  titleMax: 80,
  bodyMin: 5,
  bodyMax: 240,
} as const;

/** Risques qu'une campagne est envoyée sans que personne ne l'ait relue. */
export function campaignRequiresConfirmation(status: CampaignStatus): boolean {
  return status === 'DRAFT' || status === 'SCHEDULED';
}
