import { StyleSheet, View } from 'react-native';

import { palette, radius } from '@/theme/tokens';

import { Icon } from './ui/Icon';
import { Text } from './ui/Text';

const STEPS = ['Panier', 'Livraison', 'Paiement', 'Confirmation'] as const;

/**
 * Repère discret partagé par les écrans publics du checkout.
 *
 * Il montre la progression sans ajouter un écran ou une action au client :
 * chaque étape conserve un seul geste principal en bas d'écran.
 */
export function CheckoutProgress({ step }: { step: 1 | 2 | 3 | 4 }) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`Étape ${step} sur 4 : ${STEPS[step - 1]}`}
      accessibilityValue={{ min: 1, max: 4, now: step }}
      style={styles.root}
    >
      {STEPS.map((label, index) => {
        const number = index + 1;
        const completed = number < step;
        const active = number === step;

        return (
          <View key={label} style={styles.step}>
            <View style={styles.markerRow}>
              <View
                style={[
                  styles.marker,
                  (completed || active) && styles.markerCurrent,
                ]}
              >
                {completed ? (
                  <Icon name="check" size={11} color="white" />
                ) : (
                  <Text
                    variant="micro"
                    style={active ? styles.currentNumber : styles.number}
                  >
                    {number}
                  </Text>
                )}
              </View>
              {number < STEPS.length ? (
                <View
                  style={[styles.line, completed && styles.lineCompleted]}
                />
              ) : null}
            </View>
            <Text
              variant="micro"
              numberOfLines={1}
              style={active ? styles.currentLabel : styles.label}
            >
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'flex-start' },
  step: { flex: 1, gap: 5 },
  markerRow: { flexDirection: 'row', alignItems: 'center' },
  marker: {
    zIndex: 1,
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.line,
  },
  markerCurrent: { backgroundColor: palette.green, borderColor: palette.green },
  line: { height: 1, flex: 1, backgroundColor: palette.line },
  lineCompleted: { backgroundColor: palette.green },
  number: { color: palette.muted, fontSize: 9 },
  currentNumber: { color: palette.white, fontSize: 9 },
  label: { color: palette.muted, fontSize: 9 },
  currentLabel: { color: palette.green, fontSize: 9, fontWeight: '800' },
});
