import { StyleSheet, View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { palette, radius, spacing } from '@/theme/tokens';
import type { MapViewProps } from './MapProvider';

/**
 * Repli web et environnement de test.
 *
 * react-native-maps exige un module natif : sur le web et sous Jest, il n'est
 * pas disponible. Plutôt que de faire échouer l'écran, on affiche un substitut
 * lisible — la position reste consultable en texte à côté de la carte.
 */
export function MapView({ markers = [], height, children }: MapViewProps) {
  const courier = markers.find((m) => m.kind === 'courier');

  return (
    <View style={[styles.container, height ? { height } : styles.flex]}>
      <View style={styles.placeholder}>
        <Icon name="map" size={24} color="green" />
        <Text variant="caption" color="muted" center>
          Carte disponible sur l’application mobile
        </Text>
        {courier ? (
          <Text variant="caption" color="muted" center>
            {courier.latitude.toFixed(4)}, {courier.longitude.toFixed(4)}
          </Text>
        ) : null}
      </View>
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
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    padding: spacing.md,
    minHeight: 160,
  },
});
