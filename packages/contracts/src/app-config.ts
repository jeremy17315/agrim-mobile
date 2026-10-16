/**
 * CONFIGURATION COMMERCIALE — ce qu'AGRIM modifie sans reconstruire l'app.
 * ────────────────────────────────────────────────────────────────────────
 * Coordonnées, points de vente, informations de livraison et questions
 * fréquentes vivaient dans `company.ts`, donc dans le bundle livré : changer
 * un numéro de téléphone exigeait une nouvelle version sur le Play Store.
 *
 * Elles sont désormais servies par `GET /config/app`, lues en base, et
 * modifiables depuis l'administration de l'application.
 *
 * Les valeurs par défaut de `company.ts` restent utilisées comme REPLI
 * lorsque l'API n'est pas encore joignable — jamais comme source.
 */

export interface PointOfSale {
  id: string;
  /** Nom affiché (« Usine AGRIM », « Boutique Bélier d’Or — 227 Logement »…). */
  name: string;
  /** Adresse complète, telle qu'un client la lit à un chauffeur. */
  address: string;
  city: string;
  /** Repère utile : « en face de… », « à côté de… ». */
  landmark: string | null;
  /** Téléphone du point de vente, si AGRIM en publie un. */
  phone: string | null;
  /** Horaires en texte libre (« Lun–Sam 8h–18h »). */
  openingHours: string | null;
  latitude: number | null;
  longitude: number | null;
  /**
   * Le point accepte-t-il le retrait des commandes passées dans l'app ?
   * `false` = adresse informative seulement.
   */
  supportsPickup: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface SupportContact {
  /** Numéro à appeler (mobile du service client). */
  phone: string | null;
  /** Numéro fixe, souvent mieux adapté à un appel depuis l'étranger. */
  landlinePhone: string | null;
  /** Numéro WhatsApp au format international, sans espaces. */
  whatsapp: string | null;
  email: string | null;
}

export interface DeliveryInfo {
  /** Texte affiché sur l'écran livraison. */
  summary: string;
  /** Délais annoncés, par zone ou en texte libre. */
  delays: string;
  /** Conditions du retrait en point de vente. */
  pickupConditions: string;
  /** Mention obligatoire : les frais ne sont pas encaissés en ligne. */
  feeNotice: string;
}

export interface FaqEntry {
  question: string;
  answer: string;
}

/**
 * État des notifications poussées, publié par le serveur.
 *
 * L'application ne peut pas le deviner : `PUSH_ENABLED=false` (développement,
 * recette) signifie qu'aucun envoi ne partira. Dans ce cas, demander la
 * permission à l'utilisateur serait malhonnête — on lui ferait accepter des
 * alertes qui n'arriveront pas. L'écran de notifications le dit alors
 * franchement, et les notifications restent consultables dans l'application.
 *
 * Volontairement SANS clé VAPID : le push navigateur n'entre pas dans ce
 * périmètre (l'application web n'a pas de jeton de notification), et publier
 * une clé que personne ne consomme serait un mensonge de plus.
 */
export interface PushSettings {
  /** Le serveur peut-il réellement envoyer des notifications ? */
  enabled: boolean;
}

/** Tout ce que l'application reçoit pour se présenter au client. */
export interface AppConfig {
  version: number;
  support: SupportContact;
  pointsOfSale: PointOfSale[];
  delivery: DeliveryInfo;
  faq: FaqEntry[];
  /** État du push : l'application ne promet pas ce que le serveur ne fait pas. */
  push: PushSettings;
  /**
   * Message affiché en haut du catalogue (annonce, rupture, information).
   * Vide = pas de bandeau.
   */
  announcement: string | null;
  updatedAt: string;
}
