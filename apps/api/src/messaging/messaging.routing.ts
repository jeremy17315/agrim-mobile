import type { NotificationType } from '@agrim/contracts';

/**
 * Table de routage : quel événement métier part sur quels canaux.
 *
 * Un seul endroit décide de la politique de diffusion — le reste du code
 * l'applique. Les canaux non configurés dans le `.env` sont sautés sans
 * erreur (un canal absent n'est pas une panne) ; les canaux configurés en
 * échec laissent une ligne FAILED au `MessageLog`.
 *
 * Choix par défaut, volontairement économes (WhatsApp et SMS se paient) :
 *  - le PUSH, gratuit, porte presque tout ;
 *  - WhatsApp + e-mail sont réservés aux moments qui comptent pour le
 *    client : paiement accepté, commande livrée.
 */
export type MessageChannel = 'PUSH' | 'WHATSAPP' | 'EMAIL';

export const ROUTING: Record<string, readonly MessageChannel[]> = {
  ORDER_CREATED: ['PUSH'],
  // Le moment client par excellence : un seul message multi-canal, pas deux.
  // PAYMENT_SUCCEEDED et ORDER_CONFIRMED décrivent le même instant — le
  // paiement est l'angle SYSTEME (audit), la confirmation l'angle CLIENT.
  ORDER_CONFIRMED: ['PUSH', 'WHATSAPP', 'EMAIL'],
  ORDER_PREPARING: ['PUSH'],
  ORDER_READY: ['PUSH'],
  ORDER_OUT_FOR_DELIVERY: ['PUSH'],
  ORDER_DELIVERED: ['PUSH', 'EMAIL'],
  // Un client dont le paiement a échoué doit le savoir POUR REESSAYER :
  // l'annulation mérite les trois canaux, pas seulement le push.
  ORDER_CANCELLED: ['PUSH', 'WHATSAPP', 'EMAIL'],
  // Audit seul : la diffusion client est portée par ORDER_CONFIRMED /
  // ORDER_CANCELLED. Router aussi ici ferait deux WhatsApp pour un paiement.
  PAYMENT_SUCCEEDED: [],
  PAYMENT_FAILED: [],
  DELIVERY_ASSIGNED: ['PUSH'],
  DELIVERY_FAILED: ['PUSH'],
};

/** Types couverts par le dispatcher — declares les au drain d'outbox. */
export const ROUTED_TYPES: readonly string[] = Object.keys(ROUTING);

/** Valeurs du type `NotificationType` (contrats), pour valider le rendu. */
const KNOWN_NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  'ORDER_CREATED',
  'ORDER_CONFIRMED',
  'ORDER_PREPARING',
  'ORDER_READY',
  'ORDER_OUT_FOR_DELIVERY',
  'ORDER_DELIVERED',
  'ORDER_CANCELLED',
  'DELIVERY_ASSIGNED',
  'DELIVERY_OTP',
  'DELIVERY_FAILED',
  'PAYMENT_SUCCEEDED',
  'PAYMENT_FAILED',
  'LOW_STOCK',
]);

export function isRenderableNotificationType(
  type: string,
): type is NotificationType {
  return KNOWN_NOTIFICATION_TYPES.has(type);
}
