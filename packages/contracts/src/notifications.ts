/**
 * Contenu des notifications.
 *
 * Les textes vivent ici, pas dans le backend : la même phrase doit apparaître
 * dans la notification poussée, dans la liste en application et, plus tard,
 * dans un éventuel SMS. Une seule source évite qu'un statut soit nommé
 * « Commande partie » ici et « En livraison » ailleurs.
 */
import type { NotificationType } from './enums';
import type { OrderStatus } from './enums';

export type NotificationTemplate = {
  title: string;
  /**
   * `{reference}` est remplacé par la référence de la commande, `{code}` par
   * l'OTP de livraison — ce dernier n'est envoyé qu'au client destinataire.
   */
  body: string;
};

export const NOTIFICATION_TEMPLATES: Record<
  NotificationType,
  NotificationTemplate
> = {
  ORDER_CREATED: {
    title: 'Commande enregistrée',
    body: 'Votre commande {reference} est bien reçue. Nous la confirmons rapidement.',
  },
  ORDER_CONFIRMED: {
    title: 'Commande confirmée',
    body: 'Votre commande {reference} est confirmée et passe en préparation.',
  },
  ORDER_PREPARING: {
    title: 'Préparation en cours',
    body: 'Nous préparons votre commande {reference}.',
  },
  ORDER_READY: {
    title: 'Commande prête',
    body: 'Votre commande {reference} est prête. Un livreur va la prendre en charge.',
  },
  ORDER_READY_FOR_PICKUP: {
    title: 'Commande prête au retrait',
    body: 'Votre commande {reference} est prête. Vous pouvez venir la retirer.',
  },
  ORDER_OUT_FOR_DELIVERY: {
    title: 'Livreur en route',
    body: 'Votre commande {reference} est en route. Suivez le livreur dans l’application.',
  },
  ORDER_DELIVERED: {
    title: 'Commande livrée',
    body: 'Votre commande {reference} a été livrée. Merci de votre confiance.',
  },
  ORDER_CANCELLED: {
    title: 'Commande annulée',
    body: 'Votre commande {reference} a été annulée.',
  },
  DELIVERY_ASSIGNED: {
    title: 'Nouvelle course',
    body: 'La commande {reference} vous est affectée.',
  },
  /**
   * Le code n'apparaît PAS dans ce message.
   *
   * Une notification est conservée en base sans limite de durée et s'affiche
   * sur un écran verrouillé. Le code se consulte dans le suivi de la commande,
   * où il est déchiffré à la demande pour son seul propriétaire.
   */
  DELIVERY_OTP: {
    title: 'Votre code de livraison',
    body: 'Votre commande {reference} arrive. Ouvrez le suivi pour voir le code à communiquer au livreur à la remise.',
  },
  /**
   * Tentative de livraison infructueuse.
   *
   * Ce gabarit existe parce que la commande retourne à `READY` après un échec,
   * et que `ORDER_STATUS_NOTIFICATION` y associe « Votre commande est prête. Un
   * livreur va la prendre en charge » — message exact pour une première sortie,
   * absurde juste après une porte close. Le client doit comprendre qu'il n'a
   * rien à faire et que nous reprenons contact.
   */
  DELIVERY_FAILED: {
    title: 'Livraison non aboutie',
    body: 'Nous n’avons pas pu vous remettre la commande {reference}. Nous vous recontactons pour convenir d’un nouveau passage.',
  },
  PAYMENT_SUCCEEDED: {
    title: 'Paiement reçu',
    body: 'Le paiement de la commande {reference} est confirmé.',
  },
  PAYMENT_FAILED: {
    title: 'Paiement non abouti',
    body: 'Le paiement de la commande {reference} n’a pas abouti.',
  },
  /**
   * Déclaration du client → message destiné à l'ÉQUIPE, pas au client.
   * Le routage ne l'envoie pas au client : il vient de lui, il verrait un écho.
   */
  PAYMENT_DECLARED: {
    title: 'Paiement déclaré à vérifier',
    body: 'Le client déclare avoir payé la commande {reference}. Vérifiez la réception des fonds.',
  },
  PAYMENT_CONFIRMED: {
    title: 'Paiement confirmé',
    body: 'Nous avons vérifié la réception des fonds. Votre commande {reference} est confirmée et passe en préparation.',
  },
  PAYMENT_REJECTED: {
    title: 'Paiement non confirmé',
    body: 'Nous n’avons pas pu confirmer le paiement de la commande {reference}. Contactez-nous : vous pouvez aussi déclarer une autre référence.',
  },
  /**
   * Montant annoncé ≠ montant attendu : arbitrage humain, des deux côtés.
   * Le client doit savoir qu'un écart a été vu, sinon il attend une
   * confirmation qui n'arrivera pas.
   */
  PAYMENT_AMOUNT_MISMATCH: {
    title: 'Montant à vérifier',
    body: 'Le montant déclaré pour la commande {reference} ne correspond pas au montant attendu. AGRIM vous contacte pour régulariser.',
  },
  /** Campagne commerciale : titre et texte sont rédigés dans l'administration. */
  PROMOTION: {
    title: 'Offre Bélier d’Or',
    body: '{titre}',
  },
  LOW_STOCK: {
    title: 'Stock faible',
    body: 'Un produit atteint son seuil de réapprovisionnement.',
  },
};

/**
 * Type de notification correspondant à un statut de commande.
 *
 * `PENDING` est absent volontairement : la création est déjà notifiée par
 * `ORDER_CREATED`, prévenir deux fois du même événement lasse l'utilisateur.
 */
export const ORDER_STATUS_NOTIFICATION: Partial<
  Record<OrderStatus, NotificationType>
> = {
  CONFIRMED: 'ORDER_CONFIRMED',
  PREPARING: 'ORDER_PREPARING',
  READY: 'ORDER_READY',
  OUT_FOR_DELIVERY: 'ORDER_OUT_FOR_DELIVERY',
  DELIVERED: 'ORDER_DELIVERED',
  CANCELLED: 'ORDER_CANCELLED',
};

/**
 * Applique le gabarit : remplace `{reference}`, `{code}` et `{titre}`.
 *
 * `{titre}` n'est utilisé que par la catégorie `PROMOTION`, dont le texte vient
 * de l'administration. Il est remplacé APRÈS `{reference}` : un titre de
 * campagne ne doit pas pouvoir injecter un jeton de gabarit dans le corps.
 */
export function renderNotification(
  type: NotificationType,
  values: { reference?: string; code?: string; titre?: string } = {},
): NotificationTemplate {
  const template = NOTIFICATION_TEMPLATES[type];
  return {
    title: template.title,
    body: template.body
      .replace('{reference}', values.reference ?? '')
      .replace('{code}', values.code ?? '')
      .replace('{titre}', values.titre ?? '')
      .replace(/\s+/g, ' ')
      .trim(),
  };
}
