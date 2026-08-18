import { StyleSheet, View } from 'react-native';
import MapLibrary, { Marker, Polyline } from 'react-native-maps';

import { palette, radius } from '@/theme/tokens';
import type { MapViewProps } from './MapProvider';

/**
 * Implémentation native, adossée à react-native-maps.
 *
 * SEUL fichier de l'application autorisé à importer ce paquet : les écrans
 * passent par `MapProvider`. Une alternative (expo-maps, MapLibre) se
 * substituerait ici sans rien changer ailleurs.
 */
export function MapView({
  viewport,
  markers = [],
  polyline,
  height,
  children,
}: MapViewProps) {
  return (
    <View style={[styles.container, height ? { height } : styles.flex]}>
      <MapLibrary
        style={StyleSheet.absoluteFill}
        region={{
          latitude: viewport.center.latitude,
          longitude: viewport.center.longitude,
          latitudeDelta: viewport.latitudeDelta ?? 0.02,
          longitudeDelta: viewport.longitudeDelta ?? 0.02,
        }}
        showsUserLocation={false}
        toolbarEnabled={false}
        // Pas de bouton « ma position » : la position affichée vient du
        // serveur, pas du terminal qui regarde la carte.
        showsMyLocationButton={false}
      >
        {markers.map((marker) => (
          <Marker
            key={marker.id}
            coordinate={{
              latitude: marker.latitude,
              longitude: marker.longitude,
            }}
            title={marker.title}
            rotation={marker.heading ?? 0}
            flat={marker.kind === 'courier'}
            pinColor={marker.kind === 'courier' ? palette.green : palette.gold}
          />
        ))}

        {polyline && polyline.length > 1 ? (
          <Polyline
            coordinates={polyline}
            strokeColor={palette.green}
            strokeWidth={4}
          />
        ) : null}
      </MapLibrary>

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: palette.greenSoft,
  },
  flex: { flex: 1 },
});
