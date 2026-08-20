import { COMPANY, PROVISIONAL_REFERRAL } from '@agrim/contracts';
import { useRouter } from 'expo-router';
import { Pressable, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReferralSummary } from '@/api/referrals';
import { ErrorState, Skeleton } from '@/components/states';
import { Button, Card, Icon, Text } from '@/components/ui';
import { formatXof } from '@/lib/format';
import { palette, radius, spacing } from '@/theme/tokens';

/**
 * Parrainage.
 *
 * Le montant de récompense (PROVISIONAL_REFERRAL) et le déclencheur — la
 * première commande réellement livrée du filleul, jamais la simple
 * inscription — sont volontairement affichés tels quels : ce sont des
 * valeurs provisoires, modifiables dans un seul fichier
 * (packages/contracts/src/referral.ts) sans toucher à cet écran.
 */
export default function ParrainageScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const query = useReferralSummary();

  const share = async (code: string) => {
    await Share.share({
      message: `Rejoins-moi sur l'app ${COMPANY.name} et commande du riz ${COMPANY.brandName} ! Utilise mon code de parrainage ${code} à l'inscription.`,
    });
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Retour"
          hitSlop={12}
        >
          <Icon name="arrow-left" size={22} color="ink" />
        </Pressable>
        <Text variant="h1">Parrainage</Text>
      </View>

      {query.isPending ? (
        <View style={styles.content}>
          <Skeleton height={140} />
          <Skeleton height={100} />
        </View>
      ) : query.isError || !query.data ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <View style={styles.content}>
          <Card style={styles.codeCard}>
            <Icon name="gift" size={26} color="green" />
            <Text variant="caption" color="muted">
              Votre code personnel
            </Text>
            <Text variant="display" style={styles.code}>
              {query.data.code}
            </Text>
            <Button
              label="Partager mon code"
              icon={<Icon name="share-2" size={16} color="white" />}
              onPress={() => void share(query.data!.code)}
            />
          </Card>

          <View style={styles.statsRow}>
            <Card style={styles.statCard}>
              <Text variant="h1" color="green">
                {query.data.referralsCount}
              </Text>
              <Text variant="caption" color="muted">
                Filleul{query.data.referralsCount > 1 ? 's' : ''}
              </Text>
            </Card>
            <Card style={styles.statCard}>
              <Text variant="h1" color="green">
                {formatXof(query.data.creditBalanceXof)}
              </Text>
              <Text variant="caption" color="muted">
                Crédit gagné
              </Text>
            </Card>
          </View>

          <Card style={styles.explainCard}>
            <Text variant="h3">Comment ça marche</Text>
            <Text variant="caption" color="body">
              Partagez votre code avec vos proches. À leur inscription, ils le
              saisissent dans le champ « Code de parrainage ». Dès que leur
              première commande est livrée, vous recevez{' '}
              {formatXof(PROVISIONAL_REFERRAL.referrerRewardXof)} de crédit.
            </Text>
          </Card>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  codeCard: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.lg },
  code: { letterSpacing: 4, color: palette.green },
  statsRow: { flexDirection: 'row', gap: spacing.md },
  statCard: { flex: 1, alignItems: 'center', gap: 2 },
  explainCard: { gap: spacing.xs, borderRadius: radius.lg },
});
