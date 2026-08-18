import type { ReactNode } from 'react';

/**
 * Abstraction de cartographie.
 *
 * Contrainte produit : ne pas verrouiller l'application sur un fournisseur.
 * Les écrans n'importent jamais `react-native-maps` — ils consomment
 * `<MapView>` d'ici. Changer de prestataire (expo-maps, MapLibre, autre) se
 * fera en écrivant une nouvelle implémentation derrière ces types, sans
 * toucher aux écrans.
 */

export type LatLng = {
  latitude: number;
  longitude: number;
};

/** Marqueur affiché sur la carte. */
export type MapMarker = LatLng & {
  id: string;
  title?: string;
  /** Rôle sémantique : l'implémentation choisit la représentation. */
  kind: 'courier' | 'destination';
  /** Cap en degrés pour orienter le marqueur véhicule. */
  heading?: number | null;
};

/** Cadre à afficher : soit un centre, soit l'ensemble des points. */
export type MapViewport = {
  center: LatLng;
  /** Delta en degrés ; l'implémentation peut le traduire en zoom. */
  latitudeDelta?: number;
  longitudeDelta?: number;
};

export type MapViewProps = {
  viewport: MapViewport;
  markers?: MapMarker[];
  /** Tracé du trajet parcouru. */
  polyline?: LatLng[];
  /** Hauteur imposée ; la carte remplit sinon son conteneur. */
  height?: number;
  /** Contenu superposé (bandeau d'état, bouton de recentrage). */
  children?: ReactNode;
};

/**
 * Cadre englobant une liste de points, avec une marge.
 * Sert à afficher livreur et destination ensemble sans réglage manuel.
 */
export function boundsOf(points: LatLng[], padding = 1.6): MapViewport | null {
  if (points.length === 0) return null;

  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  return {
    center: {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
    },
    // Plancher : deux points très proches produiraient un zoom absurde.
    latitudeDelta: Math.max((maxLat - minLat) * padding, 0.01),
    longitudeDelta: Math.max((maxLng - minLng) * padding, 0.01),
  };
}
