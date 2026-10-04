import { COMPANY } from '@agrim/contracts';
import { useRouter } from 'expo-router';
import { Image, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Icon, Text } from '@/components/ui';
import { palette, radius, shadow, spacing } from '@/theme/tokens';

/**
 * Première étape du parcours d'achat.
 *
 * Inspiré d'un écran d'accueil éditorial : une identité forte, une seule
 * promesse et une seule action. Aucun menu ni compte ne coupe l'élan vers le
 * catalogue.
 */
export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.lg }]}>
      <View style={styles.topLine}>
        <Text variant="micro" color="green" style={styles.company}>
          AGRIM
        </Text>
        <Text variant="caption" color="muted">
          Riz local de Côte d’Ivoire
        </Text>
      </View>

      <View style={styles.intro}>
        <Text variant="display">Le bon riz,</Text>
        <Text variant="display" color="green">
          simplement.
        </Text>
        <Text variant="body" color="body" style={styles.copy}>
          Choisissez votre riz Bélier d’Or et faites-vous livrer en quelques
          clics.
        </Text>
      </View>

      <View style={styles.visual}>
        <View style={styles.logoHalo}>
          <Image
            source={require('../../assets/logo-agrim.png')}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel="Logo AGRIM"
          />
        </View>
        <View style={styles.brandStamp}>
          <Text variant="micro" style={styles.brandName}>
            {COMPANY.brandName.toUpperCase()}
          </Text>
          <Text variant="caption" style={styles.brandSignature}>
            {COMPANY.brandSignature}
          </Text>
        </View>
      </View>

      <View style={styles.bottom}>
        <View style={styles.dots} accessibilityLabel="Parcours express">
          <View style={[styles.dot, styles.dotActive]} />
        </View>
        <Button
          label="COMMENCER"
          onPress={() => router.push('/catalogue')}
          icon={<Icon name="arrow-right" size={19} color="white" />}
        />
        <Text variant="micro" color="muted" center>
          Commande sans compte · Livraison ou Mobile Money
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    backgroundColor: palette.bg,
  },
  topLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  company: { letterSpacing: 2.5 },
  intro: { marginTop: spacing.xxxl, gap: spacing.xs },
  copy: { maxWidth: 285, marginTop: spacing.sm, lineHeight: 20 },
  visual: {
    flex: 1,
    minHeight: 260,
    marginTop: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: radius.xl,
    backgroundColor: palette.greenDeep,
    ...shadow.card,
  },
  logoHalo: {
    width: 280,
    height: 142,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: radius.lg,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  logo: { width: 248, height: 100 },
  brandStamp: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    alignItems: 'flex-end',
  },
  brandName: { color: palette.gold, letterSpacing: 1.4 },
  brandSignature: { color: 'rgba(255,255,255,0.78)' },
  bottom: { gap: spacing.md, paddingTop: spacing.xl },
  dots: {
    flexDirection: 'row',
    alignSelf: 'center',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: palette.line,
  },
  dotActive: { width: 18, backgroundColor: palette.green },
});
