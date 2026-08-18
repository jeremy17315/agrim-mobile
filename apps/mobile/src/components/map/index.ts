/**
 * Point d'entrée de la cartographie.
 *
 * Metro choisit automatiquement `MapView.native.tsx` sur iOS/Android et
 * `MapView.tsx` ailleurs : les écrans importent toujours '@/components/map'.
 */
export { MapView } from './MapView';
export {
  boundsOf,
  type LatLng,
  type MapMarker,
  type MapViewProps,
  type MapViewport,
} from './MapProvider';
