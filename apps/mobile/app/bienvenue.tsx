import { useRouter } from 'expo-router';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Text } from '@/components/ui';
import { useOnboardingStore } from '@/store/onboarding';
import { palette, radius, spacing } from '@/theme/tokens';

/** Premier écran : une porte d'entrée visuelle, pas un formulaire. */
export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const start = useOnboardingStore((state) => state.start);

  const enterCatalog = async () => {
    await start();
    router.replace('/catalogue');
  };

  const enterLogin = async () => {
    await start();
    router.push('/(auth)/connexion');
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.brandBlock}>
        <Image source={require('../assets/logo-agrim.png')} style={styles.logo} resizeMode="contain" />
        <Text variant="caption" color="body" center>Le bon riz, simplement.</Text>
      </View>
      <View style={styles.heroWrap}>
        <Image source={require('../assets/welcome-hero.png')} style={styles.hero} resizeMode="cover" />
        <View style={styles.heroOverlay} />
        <View style={styles.heroCopy}>
          <Text variant="display" color="white" center>Le goût de chez nous.</Text>
          <Text variant="body" style={styles.heroText} center>Découvrez les produits AGRIM et commandez en quelques étapes.</Text>
        </View>
      </View>
      <View style={styles.bottom}>
        <Button label="COMMENCER" onPress={() => void enterCatalog()} />
        <Pressable onPress={() => void enterLogin()} accessibilityRole="button">
          <Text variant="caption" color="muted" center>Déjà un espace AGRIM ? Se connecter</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg, paddingHorizontal: spacing.lg, gap: spacing.lg },
  brandBlock: { alignItems: 'center', gap: spacing.xs, paddingTop: spacing.lg },
  logo: { width: 164, height: 62 },
  heroWrap: { flex: 1, minHeight: 260, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: palette.green, position: 'relative' },
  hero: { width: '100%', height: '100%' },
  heroOverlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(7,64,20,0.42)' },
  heroCopy: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.xl, gap: spacing.sm },
  heroText: { color: 'rgba(255,255,255,0.9)', textAlign: 'center' },
  bottom: { gap: spacing.md },
});
