/**
 * PAIEMENT DIRECT MANUEL — contrat partagé.
 * ──────────────────────────────────────────
 * Décision commerciale du 11 octobre 2026 : AGRIM n'utilise plus d'agrégateur
 * de paiement (commissions sur chaque transaction). Le client transfère
 * lui-même le montant vers le numéro mobile money officiel d'AGRIM, puis
 * déclare sa transaction ; un responsable vérifie la réception RÉELLE des
 * fonds avant de confirmer la commande.
 *
 * Trois invariants, écrits ici parce qu'ils doivent survivre aux refontes
 * d'écran :
 *
 *  1. **Aucun paiement n'est confirmé automatiquement.** Ni la déclaration du
 *     client, ni une capture d'écran, ni le retour dans l'application après un
 *     transfert ne valent preuve. Seule une action d'administrateur
 *     authentifié et journalisée fait passer un paiement à `SUCCEEDED`.
 *  2. **Le numéro de réception n'est jamais codé en dur.** Il vient de la
 *     configuration gérée par AGRIM (`/payments/methods`).
 *  3. **Le montant et la référence viennent du serveur.** Le client ne peut ni
 *     les modifier, ni choisir son statut.
 */
import type { PaymentStatus } from './enums';

/* ─────────────────────────── Moyens de paiement ─────────────────────────── */

/**
 * Un moyen de paiement direct, tel qu'AGRIM L'A CONFIGURÉ.
 *
 * `receivingNumber` est le numéro officiel de réception. Il est public par
 * nécessité — le client doit le composer — et n'est donc PAS un secret.
 */
export interface DirectPaymentMethod {
  /** Code technique stable (`ORANGE_MONEY`, `MTN_MOMO`, `WAVE`…). */
  code: string;
  /** Nom affiché de l'opérateur, rédigé par AGRIM. */
  operatorName: string;
  /** Numéro officiel de réception, tel qu'il doit être composé. */
  receivingNumber: string;
  /** Nom du bénéficiaire, quand il est renseigné. */
  beneficiaryName: string | null;
  /** Instructions rédigées par AGRIM (étapes, précautions). */
  instructions: string | null;
  /**
   * Modèle d'ouverture de l'application de l'opérateur, s'il en existe un.
   * Ex. `tel:*144*1*1*{number}*{amount}%23` — les jetons `{number}` et
   * `{amount}` sont substitués par le client.
   *
   * On n'affirme rien de plus : si l'opérateur n'expose pas de parcours
   * ouvrable, ce champ reste vide et l'application se contente d'afficher le
   * numéro à recopier — elle ne prétend pas déclencher le transfert.
   */
  ussdTemplate: string | null;
  /**
   * Contenu EXACT du QR marchand de l'opérateur, quand AGRIM l'a publié.
   *
   * C'est le même texte que celui encodé dans le QR remis par MTN, Orange ou
   * Wave : l'application le réaffiche tel quel, en QR, pour le client qui
   * préfère scanner plutôt que recopier le numéro. Il n'est PAS fabriqué par
   * l'application — un contenu inventé enverrait l'argent du client à un
   * inconnu — et il n'est pas un secret : il ne contient rien de plus que le
   * numéro marchand déjà affiché.
   *
   * `null` = aucun QR publié pour ce compte : l'écran n'en affiche aucun.
   */
  qrPayload: string | null;

  /**
   * Lien de paiement publié par AGRIM, quand l'opérateur en fournit un.
   *
   * C'est la réponse au cas le plus courant : **un seul téléphone**. Un QR
   * affiché sur l'écran ne peut pas être scanné par ce même téléphone ; un
   * lien, si. L'application l'ouvre avec `Linking.openURL` — l'application de
   * l'opérateur (ou le navigateur) prend le relais et le client paie là-bas.
   *
   * Seuls `http://`, `https://` et `tel:` sont acceptés : un schéma inconnu
   * (`javascript:`, `file:`…) ne doit jamais pouvoir être ouvert.
   *
   * `null` = aucun lien publié : l'écran n'affiche pas de bouton.
   */
  paymentUrl: string | null;
}

/**
 * Bornes partagées : le serveur refuse au-delà, l'écran d'administration le
 * dit avant l'enregistrement.
 *
 * - 1000 caractères pour le QR : les QR marchands des opérateurs (EMVCo) font
 *   quelques centaines de caractères ; au-delà, c'est une erreur de
 *   copier-coller.
 * - 500 pour le lien de paiement : une URL d'opérateur tient largement.
 */
export const PAYMENT_METHOD_LIMITS = {
  qrPayloadMax: 1000,
  paymentUrlMax: 500,
} as const;

/** Schémas qu'une application a le droit d'OUVRIR, et rien d'autre. */
export const PAYMENT_LINK_SCHEMES = ['https://', 'http://', 'tel:'] as const;

/** Ce texte est-il un lien ouvrable (et pas une donnée de QR brute) ? */
export function isOpenablePaymentLink(value: string | null): boolean {
  if (!value) return false;
  const propre = value.trim().toLowerCase();
  return PAYMENT_LINK_SCHEMES.some((scheme) => propre.startsWith(scheme));
}

/**
 * Le lien à ouvrir pour payer DEPUIS CE TÉLÉPHONE, ou `null`.
 *
 * Deux sources, dans cet ordre :
 *  1. `paymentUrl`, publié pour ça ;
 *  2. à défaut, le contenu du QR **s'il est lui-même un lien** — c'est le cas
 *     de Wave, dont le QR marchand contient l'URL de paiement. On ne demande
 *     donc pas à AGRIM de saisir deux fois la même information.
 *
 * Un QR au format EMVCo (`0002010102…`), que seul le scanner de l'opérateur
 * sait lire, ne donne AUCUN lien : renvoyer `null` est la seule réponse
 * honnête, et l'écran propose alors les autres voies (code USSD, numéro).
 */
export function paymentLinkToOpen(
  method: Pick<DirectPaymentMethod, 'paymentUrl' | 'qrPayload'>,
): string | null {
  if (isOpenablePaymentLink(method.paymentUrl)) {
    return method.paymentUrl?.trim() ?? null;
  }
  if (isOpenablePaymentLink(method.qrPayload)) {
    return method.qrPayload?.trim() ?? null;
  }
  return null;
}

/**
 * Code USSD à composer, jetons remplacés.
 *
 * `{number}` → numéro de réception, `{amount}` → montant entier, sans
 * séparateur (les opérateurs n'en veulent pas). Un modèle sans jeton (code
 * fixe, ex. `#144#`) est légitime et rendu tel quel.
 *
 * `null` = pas de code publié : le client compose le numéro à la main.
 */
export function buildUssdCode(
  template: string | null,
  values: { number: string; amount: number },
): string | null {
  const modele = template?.trim();
  if (!modele) return null;
  return modele
    .split('{number}')
    .join(values.number)
    .split('{amount}')
    .join(String(Math.max(0, Math.trunc(values.amount))));
}

/**
 * URL à ouvrir pour que le téléphone COMPOSE le code USSD.
 *
 * `#` doit être encodé (`%23`), sinon la fin du code est perdue : le `#` nu
 * termine l'URL. ⚠️ iOS refuse les codes USSD (Apple les bloque) : c'est à
 * l'appelant de n'offrir ce geste que là où il aboutit, et de le dire.
 */
export function ussdDialUrl(code: string): string {
  return `tel:${code.replace(/#/g, '%23')}`;
}

/* ─────────────────────── Statuts, côté client ──────────────────────────── */

export interface PaymentStatusPresentation {
  /** Libellé court, affichable dans une étiquette. */
  label: string;
  /** Phrase destinée au client, à la deuxième personne. */
  customerMessage: string;
  /** Le client doit-il agir, ou attendre AGRIM ? */
  owner: 'CLIENT' | 'AGRIM' | 'AUCUN';
  /** Ton visuel : `ok` (rien à faire), `wait` (patience), `ko` (problème). */
  tone: 'ok' | 'wait' | 'ko';
}

export const PAYMENT_STATUS_PRESENTATION: Record<
  PaymentStatus,
  PaymentStatusPresentation
> = {
  PENDING: {
    label: 'Paiement en attente',
    customerMessage:
      'Votre commande est enregistrée. Effectuez le transfert, puis déclarez-le dans l’application.',
    owner: 'CLIENT',
    tone: 'wait',
  },
  AWAITING_CONFIRMATION: {
    label: 'Paiement en attente',
    customerMessage:
      'Votre commande est enregistrée. Effectuez le transfert, puis déclarez-le dans l’application.',
    owner: 'CLIENT',
    tone: 'wait',
  },
  DECLARED_BY_CUSTOMER: {
    label: 'Paiement déclaré',
    customerMessage:
      'Merci. Votre déclaration est enregistrée : AGRIM vérifie la réception des fonds.',
    owner: 'AGRIM',
    tone: 'wait',
  },
  UNDER_REVIEW: {
    label: 'Vérification en cours',
    customerMessage:
      'AGRIM vérifie votre paiement. Vous serez prévenu dès la confirmation.',
    owner: 'AGRIM',
    tone: 'wait',
  },
  SUCCEEDED: {
    label: 'Paiement confirmé',
    customerMessage: 'Votre paiement est confirmé. Votre commande est prise en charge.',
    owner: 'AUCUN',
    tone: 'ok',
  },
  REJECTED: {
    label: 'Paiement non confirmé',
    customerMessage:
      'AGRIM n’a pas pu confirmer ce paiement. Contactez-nous : vous pouvez aussi déclarer une autre référence.',
    owner: 'CLIENT',
    tone: 'ko',
  },
  FAILED: {
    label: 'Paiement échoué',
    customerMessage: 'Le paiement n’a pas abouti.',
    owner: 'CLIENT',
    tone: 'ko',
  },
  EXPIRED: {
    label: 'Paiement expiré',
    customerMessage: 'Le délai de paiement est dépassé.',
    owner: 'CLIENT',
    tone: 'ko',
  },
  REFUNDED: {
    label: 'Paiement remboursé',
    customerMessage: 'Ce paiement a été remboursé.',
    owner: 'AUCUN',
    tone: 'ko',
  },
};

/* ────────────────── L'instruction de paiement affichée ─────────────────── */

/**
 * Ce que l'écran de paiement reçoit du serveur pour UNE commande.
 *
 * Aucun de ces champs n'est calculé par le téléphone : le montant est le
 * montant figé de la commande, la référence est celle du serveur.
 */
export interface PaymentInstruction {
  reference: string;
  /** Montant exact à transférer, en XOF entier. */
  amount: number;
  currency: 'XOF';
  status: PaymentStatus;
  method: DirectPaymentMethod;
  /** Référence à rappeler au moment du transfert (c'est la référence de commande). */
  paymentReference: string;
  /** Nombre de déclarations déjà déposées (borne côté serveur). */
  declarations: number;
  /** Dernière déclaration, pour réafficher ce que le client a saisi. */
  lastDeclaration: {
    transactionReference: string;
    declaredAmount: number;
    submittedAt: string;
    status: PaymentStatus;
  } | null;
  /**
   * Motif du dernier rejet, quand il y en a un.
   *
   * Un rejet sans motif laisserait le client sans recours — il a payé, il ne
   * comprend pas, et personne ne peut lui expliquer. Le motif est donc rédigé
   * par le vérificateur, obligatoire, et affiché ici.
   */
  rejectionNote: string | null;
}

/** Bornes partagées : le serveur ET le formulaire appliquent les mêmes. */
export const PAYMENT_DECLARATION_LIMITS = {
  /** Référence de transaction : longueurs observées chez les opérateurs. */
  referenceMin: 4,
  referenceMax: 60,
  /** Justificatif : 5 Mo, images et PDF uniquement. */
  proofMaxBytes: 5 * 1024 * 1024,
  proofMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  /** Nombre de déclarations acceptées par commande. */
  maxPerOrder: 5,
} as const;

/**
 * Écart toléré entre le montant annoncé et le montant attendu, en francs.
 * Au-delà, la commande part en vérification manuelle : c'est AGRIM qui
 * tranche, jamais l'application.
 */
export const PAYMENT_AMOUNT_TOLERANCE_XOF = 0;

/** Le montant déclaré correspond-il à celui attendu ? */
export function amountMatches(declared: number, expected: number): boolean {
  return Math.abs(declared - expected) <= PAYMENT_AMOUNT_TOLERANCE_XOF;
}

/* ─────────────────────────── Texte à partager ──────────────────────────── */

/**
 * Bloc d'instructions copiable d'un seul geste.
 *
 * Le client qui transfère depuis une autre application a besoin du numéro ET
 * de la référence sous les yeux : un texte unique évite qu'il recopie la
 * mauvaise commande.
 */
export function buildPaymentInstructionsText(input: {
  method: DirectPaymentMethod;
  amount: number;
  reference: string;
  companyName?: string;
}): string {
  const { method, amount, reference } = input;
  const lignes = [
    `Paiement AGRIM — commande ${reference}`,
    `Montant : ${amount.toLocaleString('fr-FR')} F CFA`,
    `Numéro ${method.operatorName} : ${method.receivingNumber}`,
  ];
  if (method.beneficiaryName) {
    lignes.push(`Bénéficiaire : ${method.beneficiaryName}`);
  }
  lignes.push(`Référence à indiquer : ${reference}`);
  return lignes.join('\n');
}
