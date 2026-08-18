/**
 * Contrat de SUIVI GPS TEMPS RÉEL (validé par le client sur la maquette v1).
 *
 * Deux usages :
 *  - le LIVREUR émet sa position pendant une course (écrans 23-24) ;
 *  - le CLIENT consomme la position de sa livraison (écran 18).
 *
 * Règles structurantes :
 *  - Aucun fournisseur de cartographie n'apparaît ici. Le rendu passe par un
 *    MapProvider côté mobile ; ces types restent valables si l'on change de
 *    prestataire.
 *  - Le mobile n'écrit JAMAIS dans une base : il appelle l'API, qui arbitre.
 *  - Le suivi n'est actif que pour une livraison en cours. Hors de cette
 *    fenêtre, aucune position n'est collectée ni conservée (minimisation).
 */
import { z } from 'zod';

import type { DeliveryStatus } from './enums';

/* ------------------------------ Primitives ------------------------------ */

export const latitudeSchema = z.number().min(-90).max(90);
export const longitudeSchema = z.number().min(-180).max(180);

/** Position brute remontée par le terminal du livreur. */
export const geoPointSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  /** Précision horizontale en mètres (halo affiché sur la carte). */
  accuracy: z.number().min(0).max(10_000).nullable(),
  /** Cap en degrés, 0 = nord. Oriente le marqueur véhicule. */
  heading: z.number().min(0).max(360).nullable(),
  /** Vitesse instantanée en m/s (convertie en km/h à l'affichage). */
  speed: z.number().min(0).max(70).nullable(),
  /** Horodatage de la MESURE, pas de la réception serveur. */
  recordedAt: z.iso.datetime(),
});
export type GeoPoint = z.infer<typeof geoPointSchema>;

/* --------------------------- Émission (livreur) -------------------------- */

/**
 * Le livreur envoie un LOT de positions, pas une seule.
 * Motif : en zone de couverture faible, les points sont mis en file localement
 * puis rejoués au retour du réseau. Le serveur déduplique sur `recordedAt`.
 */
export const pushLocationsSchema = z.object({
  deliveryId: z.uuid(),
  points: z.array(geoPointSchema).min(1).max(100),
});
export type PushLocations = z.infer<typeof pushLocationsSchema>;

/* --------------------------- Lecture (client) ---------------------------- */

/** Instruction de navigation en cours, affichée au livreur (écran 24). */
export const navigationStepSchema = z.object({
  instruction: z.string().min(1).max(200),
  /** Distance restante avant la manœuvre, en mètres. */
  distanceMeters: z.number().int().min(0),
  streetName: z.string().max(160).nullable(),
});
export type NavigationStep = z.infer<typeof navigationStepSchema>;

/**
 * Vue de suivi renvoyée au client. Volontairement pauvre :
 * ni téléphone personnel du livreur au-delà du numéro de service, ni historique
 * complet du trajet, ni position hors livraison active.
 */
export const deliveryTrackingSchema = z.object({
  deliveryId: z.uuid(),
  orderReference: z.string(),
  /** null tant qu'aucune position n'a été reçue (réseau, GPS coupé). */
  currentPosition: geoPointSchema.nullable(),
  /** Destination = adresse de livraison, connue dès la commande. */
  destination: z.object({
    latitude: latitudeSchema.nullable(),
    longitude: longitudeSchema.nullable(),
    landmark: z.string().max(255).nullable(),
  }),
  /** Distance restante estimée, en mètres. */
  remainingMeters: z.number().int().min(0).nullable(),
  /** Durée restante estimée, en secondes. */
  etaSeconds: z.number().int().min(0).nullable(),
  /** Heure d'arrivée estimée, calculée par le SERVEUR (source unique). */
  estimatedArrivalAt: z.iso.datetime().nullable(),
  /** Fraîcheur de la donnée : le mobile affiche « il y a N s ». */
  lastUpdateAt: z.iso.datetime().nullable(),
  /** false ⇒ l'UI bascule sur l'état « position indisponible ». */
  isLive: z.boolean(),
  courier: z
    .object({
      firstName: z.string().max(80),
      /** Numéro de mise en relation, jamais le numéro privé. */
      contactPhone: z.string().nullable(),
      vehicleType: z
        .enum(['MOTO', 'TRICYCLE', 'VOITURE', 'CAMIONNETTE'])
        .nullable(),
    })
    .nullable(),
});
export type DeliveryTracking = z.infer<typeof deliveryTrackingSchema>;

/* ------------------------------ Paramètres ------------------------------ */

/**
 * Réglages de collecte, centralisés et modifiables (pas de valeur en dur dans
 * les écrans). Calibrés pour préserver batterie et forfait data.
 */
export const TRACKING_CONFIG = {
  /** Distance minimale entre deux points conservés. */
  distanceIntervalMeters: 50,
  /** Intervalle minimal entre deux points conservés. */
  timeIntervalSeconds: 15,
  /** Cadence d'interrogation par le client. */
  clientPollSeconds: 20,
  /** Au-delà, la position est jugée périmée : `isLive` passe à false. */
  stalePositionSeconds: 120,
  /** Taille maximale de la file hors ligne côté livreur. */
  offlineQueueMaxPoints: 500,
  /** Purge des traces après livraison (minimisation des données). */
  retentionDaysAfterDelivery: 30,
} as const;

/** Statuts pendant lesquels le suivi GPS est actif. */
export const TRACKABLE_DELIVERY_STATUSES = [
  'PICKED_UP',
  'IN_TRANSIT',
] as const satisfies readonly DeliveryStatus[];

export function isTrackable(status: DeliveryStatus): boolean {
  return (TRACKABLE_DELIVERY_STATUSES as readonly DeliveryStatus[]).includes(
    status,
  );
}
