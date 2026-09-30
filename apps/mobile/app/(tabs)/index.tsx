import { COMPANY } from '@agrim/contracts';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Icon, Text } from '@/components/ui';
import { palette, radius, spacing } from '@/theme/tokens';

/**
 * Point d'entrée volontairement unique : ouvrir, commencer, acheter.
 * Aucun compte, menu ou choix secondaire ne retarde l'accès aux produits.
 */
export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.xl }]}>
      <View style={styles.hero}>
        <View style={styles.grainHalo}>
          <Icon name="wheat" size={68} color="gold" />
        </View>
        <Text variant="micro" style={styles.agrim}>
          AGRIM
        </Text>
        <Text variant="display" color="white" center>
          {COMPANY.brandName}
        </Text>
        <Text variant="body" style={styles.signature} center>
          {COMPANY.brandSignature}
        </Text>
      </View>

      <View style={styles.body}>
        <Text variant="h1" center>
          Votre riz, en quelques clics.
        </Text>
        <Text variant="body" color="muted" center>
          Choisissez vos produits, indiquez votre nom, votre téléphone et votre
          lieu de livraison. C’est tout.
        </Text>

        <Button
          label="COMMENCER"
          onPress={() => router.push('/catalogue')}
          icon={<Icon name="arrow-right" size={19} color="white" />}
        />

        <Text variant="micro" color="muted" center>
          Commande sans compte
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: palette.bg,
    justifyContent: 'space-between',
  },
  hero: {
    marginHorizontal: spacing.lg,
    minHeight: 330,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
    backgroundColor: palette.greenDeep,
    borderRadius: radius.xl,
  },
  grainHalo: {
    width: 132,
    height: 132,
    borderRadius: 66,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    marginBottom: spacing.sm,
  },
  agrim: { color: 'rgba(255,255,255,0.65)', letterSpacing: 3 },
  signature: { color: 'rgba(255,255,255,0.86)' },
  body: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxxl },
});
