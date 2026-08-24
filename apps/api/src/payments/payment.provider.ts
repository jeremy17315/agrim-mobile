/**
 * Contrat de passerelle de paiement.
 *
 * Aucun agrégateur n'apparaît ici. Le reste de l'application ne connaît que
 * cette interface : changer de fournisseur se fait en ajoutant un pilote,
 * sans toucher aux modules métier.
 *
 * Portage de `backend/app/paiement.py` du site web, qui a déjà essuyé les
 * plâtres en production. Les commentaires marqués « leçon » signalent un bug
 * réel qui a coûté de l'argent : ne pas les retirer sans comprendre pourquoi
 * ils sont là.
 */

/**
 * Un paiement mobile est **asynchrone** : on ouvre la transaction, le client
 * valide sur son téléphone, l'opérateur nous rappelle plus tard. Trois issues
 * seulement, quel que soit le fournisseur.
 */
export type GatewayStatus = 'PAID' | 'PENDING' | 'FAILED';

/** Ce que l'on connaît de la commande au moment d'ouvrir la transaction. */
export interface PaymentIntent {
  orderReference: string;
  /** Montant en francs CFA, entier. Jamais de flottant sur de la monnaie. */
  amountXof: number;
  customerName: string;
  customerPhone: string;
  /** `null` pour un paiement par carte : l'agrégateur laisse alors le choix. */
  provider: 'ORANGE_MONEY' | 'MTN_MOMO' | 'MOOV_MONEY' | 'WAVE' | null;
}

export interface GatewayInitiation {
  status: GatewayStatus;
  /** Identifiant de transaction chez le fournisseur, à conserver. */
  providerReference: string;
  /** Page de validation à ouvrir. Vide quand il n'y en a pas. */
  checkoutUrl: string;
  /** Texte affichable au client, déjà en français. */
  message: string;
}

export interface GatewayVerification {
  status: GatewayStatus;
  message: string;
}

/** Lecture d'un appel entrant de l'opérateur, une fois son authenticité établie. */
export interface GatewayCallback {
  providerReference: string;
  orderReference: string;
  status: GatewayStatus;
}

/**
 * Échec technique de la passerelle : réseau, configuration, réponse illisible.
 * Distinct d'un refus de paiement, qui est un résultat métier normal.
 */
export class PaymentGatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentGatewayError';
  }
}

export abstract class PaymentProvider {
  /** Identifiant en minuscules, tel qu'il apparaît dans l'URL de callback. */
  abstract readonly name: string;

  /**
   * Le corps du callback fait-il foi à lui seul ?
   *
   * Non par défaut, et ce défaut est le bon : un webhook est un message non
   * sollicité venu d’Internet. Seul le pilote de simulation, qui n’encaisse
   * rien, met ce drapeau à `true`. Pour tous les autres, un succès annoncé
   * est reconfirmé auprès de l’API du fournisseur avant inscription en base.
   */
  readonly callbackIsProof: boolean = false;

  /**
   * Le pilote dispose-t-il de **tous** ses identifiants ?
   *
   * Leçon : la version initiale du site ne vérifiait pas le secret CinetPay.
   * Avec api_key + site_id seuls, la configuration passait pour valide mais
   * tous les callbacks étaient rejetés à la vérification de signature —
   * argent encaissé, commandes jamais confirmées.
   */
  abstract isConfigured(): boolean;

  abstract initiate(intent: PaymentIntent): Promise<GatewayInitiation>;

  /**
   * Interroge le fournisseur sur l'état réel d'une transaction.
   * Sert de filet quand le webhook n'est jamais arrivé, et de contre-vérité
   * quand il arrive : un webhook annonçant un succès n'est jamais cru sur parole.
   */
  abstract verify(providerReference: string): Promise<GatewayVerification>;

  /**
   * Interprète l'appel entrant de l'opérateur, après contrôle d'authenticité.
   * Lève `PaymentGatewayError` si la signature est invalide.
   */
  abstract readCallback(
    body: Record<string, unknown>,
    headers: Record<string, string | undefined>,
  ): GatewayCallback;
}

/** Jeton d'injection. */
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
