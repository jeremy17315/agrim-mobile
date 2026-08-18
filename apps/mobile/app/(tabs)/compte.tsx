import { COMPANY } from '@agrim/contracts';
import { useRouter } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Icon, Text, type IconName } from '@/components/ui';
import { formatPhone } from '@/lib/format';
import { useAuthStore } from '@/store/auth';
import { palette, radius, spacing } from '@/theme/tokens';

/**
 * Compte client.
 *
 * Deux états nets : connecté ou non. Pas de demi-mesure où l'écran afficherait
 * des entrées inutilisables — un lien qui mène à un mur d'authentification est
 * plus frustrant qu'une invitation claire à se connecter.
 */
export default function CompteScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const isAuthenticated = useAuthStore((s) => s.accessToken !== null);

  const confirmSignOut = () => {
    Alert.alert(
      'Se déconnecter',
      'Vous devrez saisir à nouveau vos identifiants.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Se déconnecter',
          style: 'destructive',
          onPress: () => void signOut(),
        },
      ],
    );
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
      <Text variant="h1" style={styles.title}>
        Mon compte
      </Text>

      <ScrollView contentContainerStyle={styles.body}>
        {isAuthenticated && user ? (
          <>
            <Card style={styles.identity}>
              <View style={styles.avatar}>
                <Text variant="h2" color="white">
                  {initials(user.firstName, user.lastName)}
                </Text>
              </View>
              <View style={styles.flex}>
                <Text variant="h3">
                  {user.firstName} {user.lastName}
                </Text>
                <Text variant="caption" color="muted">
                  {formatPhone(user.phone)}
                </Text>
              </View>
            </Card>

            <View style={styles.menu}>
              <MenuRow
                icon="package"
                label="Mes commandes"
                hint="Historique et suivi"
                onPress={() => router.push('/commandes')}
              />
              <MenuRow
                icon="map-pin"
                label="Mes adresses"
                hint="Lieux de livraison"
                onPress={() => router.push('/commande/adresse')}
              />
            </View>

            <Button
              label="Se déconnecter"
              variant="outline"
              onPress={confirmSignOut}
            />
          </>
        ) : (
          <Card style={styles.signedOut}>
            <Icon name="circle-user" size={30} color="green" />
            <Text variant="h3">Connexion requise</Text>
            <Text variant="caption" color="muted" center>
              Connectez-vous pour commander et suivre vos livraisons.
            </Text>
            <Button
              label="Se connecter"
              onPress={() => router.push('/(auth)/connexion')}
            />
            <Pressable
              onPress={() => router.push('/(auth)/inscription')}
              accessibilityRole="button"
              hitSlop={8}
            >
              <Text variant="caption" color="green">
                Créer un compte
              </Text>
            </Pressable>
          </Card>
        )}

        <Card style={styles.contact}>
          <Icon name="phone" size={18} color="gold" />
          <View style={styles.flex}>
            <Text variant="h3">{COMPANY.name}</Text>
            <Text variant="caption" color="muted">
              {formatPhone(COMPANY.phone)}
            </Text>
            <Text variant="caption" color="muted">
              {COMPANY.address}
            </Text>
          </View>
        </Card>
      </ScrollView>
    </View>
  );
}

function MenuRow({
  icon,
  label,
  hint,
  onPress,
}: {
  icon: IconName;
  label: string;
  hint: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Card style={styles.menuRow}>
        <Icon name={icon} size={19} color="green" />
        <View style={styles.flex}>
          <Text variant="bodyStrong">{label}</Text>
          <Text variant="caption" color="muted">
            {hint}
          </Text>
        </View>
        <Icon name="chevron-right" size={17} color="muted" />
      </Card>
    </Pressable>
  );
}

function initials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  title: { paddingHorizontal: spacing.lg },
  body: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },
  flex: { flex: 1, gap: 2 },

  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    backgroundColor: palette.green,
    alignItems: 'center',
    justifyContent: 'center',
  },

  menu: { gap: spacing.sm },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },

  signedOut: { alignItems: 'center', gap: spacing.sm },
  contact: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
