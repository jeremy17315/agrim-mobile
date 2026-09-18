/**
 * Contrat d'un consommateur d'événements d'outbox.
 *
 * Le cœur métier écrit des événements (`OutboxEvent`) dans sa transaction ;
 * les modules de diffusion (notifications, analytics, facturation…) y
 * souscrivent en déclarant des handlers ici. Aucun module métier n'appelle
 * jamais FCM, WhatsApp ou SMTP directement — c'est la règle « notifications
 * découplées » (docs/refonte/02, § 3.5).
 */
export interface OutboxHandler {
  /** Types d'événements traités (`ORDER_CONFIRMED`, `PAYMENT_FAILED`…).
   * Un handler peut couvrir plusieurs types — le dispatcher de messagerie
   * couvre les siens par sa table de routage. */
  readonly types: readonly string[];

  /** Traite l'événement. Doit être idempotent : un événement peut être
   * rejoué après un bail expiré ou un échec partiel. */
  handle(event: OutboxEventPayload): Promise<void>;
}

/** Charge utile d'un événement, telle que stockée en base. */
export interface OutboxEventPayload {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
}

/** Jeton d'injection des handlers enregistrés (vide par défaut). */
export const OUTBOX_HANDLERS = Symbol('OUTBOX_HANDLERS');
