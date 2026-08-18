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
  DELIVERY_OTP: {
    title: 'Votre code de livraison',
    body: 'Code {code} pour la commande {reference}. Communiquez-le au livreur à la remise, jamais avant.',
  },
  PAYMENT_SUCCEEDED: {
    title: 'Paiement reçu',
    body: 'Le paiement de la commande {reference} est confirmé.',
  },
  PAYMENT_FAILED: {
    title: 'Paiement non abouti',
    body: 'Le paiement de la commande {reference} n’a pas abouti.',
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

/** Applique le gabarit : remplace `{reference}` par la valeur réelle. */
export function renderNotification(
  type: NotificationType,
  values: { reference?: string; code?: string } = {},
): NotificationTemplate {
  const template = NOTIFICATION_TEMPLATES[type];
  return {
    title: template.title,
    body: template.body
      .replace('{reference}', values.reference ?? '')
      .replace('{code}', values.code ?? '')
      .replace(/\s+/g, ' ')
      .trim(),
  };
}
