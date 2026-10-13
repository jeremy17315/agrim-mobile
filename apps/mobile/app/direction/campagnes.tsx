import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { describeError } from '@/api/errors';
import {
  CAMPAIGN_CATEGORIES,
  CAMPAIGN_LINK_TARGETS,
  useCampaigns,
  useSendCampaign,
  type Campaign,
  type CampaignInput,
} from '@/api/campaigns';
import { EmptyState, ErrorState, Skeleton } from '@/components/states';
import { Banner, Button, Card, Icon, Input, Pill, Text } from '@/components/ui';
import { palette, spacing } from '@/theme/tokens';

/**
 * Campagnes de notifications — ADMINISTRATEUR uniquement.
 *
 * Règles affichées, et appliquées côté serveur :
 *  - le test part uniquement vers VOS appareils ;
 *  - l'envoi à tous exige une confirmation explicite ;
 *  - le résultat compte ce qui a été ACCEPTÉ et REFUSÉ. Aucune lecture n'est
 *    suivie : l'écran ne l'affiche jamais.
 */
export default function CampagnesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const history = useCampaigns();
  const send = useSendCampaign();

  const [category, setCategory] = useState<CampaignInput['category']>('PROMOTION');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [linkTarget, setLinkTarget] = useState<string>('information');
  const [linkValue, setLinkValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const construire = (audience: CampaignInput['audience']): CampaignInput | null => {
    setError(null);
    if (title.trim().length < 3) {
      setError('Le titre doit contenir au moins 3 caractères.');
      return null;
    }
    if (body.trim().length < 5) {
      setError('Le message doit contenir au moins 5 caractères.');
      return null;
    }
    if (imageUrl.trim() && !/^https:\/\//.test(imageUrl.trim())) {
      setError("L'image doit être une adresse https.");
      return null;
    }
    if (linkTarget !== 'information' && !linkValue.trim()) {
      setError('Indiquez la destination du lien.');
      return null;
    }
    return {
      category,
      title: title.trim(),
      body: body.trim(),
      imageUrl: imageUrl.trim() || undefined,
      linkTarget,
      linkValue: linkTarget === 'information' ? undefined : linkValue.trim(),
      audience,
    };
  };

  const lancer = async (input: CampaignInput) => {
    try {
      const result = await send.mutateAsync(input);
      Alert.alert(
        input.audience === 'TEST' ? 'Test envoyé' : 'Campagne envoyée',
        `Appareils acceptés : ${result.sentCount}\nAppareils refusés : ${result.failedCount}\n\nLes lectures ne sont pas suivies.`,
      );
    } catch (cause) {
      setError(describeError(cause));
    }
  };

  const envoyerTest = () => {
    const input = construire('TEST');
    if (input) void lancer(input);
  };

  const envoyerATous = () => {
    const input = construire('ALL_OPTED_IN');
    if (!input) return;
    Alert.alert(
      'Envoyer à tous les clients ?',
      'Seuls les clients ayant accepté les promotions recevront ce message. Cet envoi ne peut pas être annulé.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Envoyer',
          style: 'destructive',
          onPress: () => void lancer({ ...input, confirm: true }),
        },
      ],
    );
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Retour"
          hitSlop={12}
          style={styles.backButton}
        >
          <Icon name="arrow-left" size={19} color="ink" />
        </Pressable>
        <View style={styles.flex}>
          <Text variant="h3">Campagnes</Text>
          <Text variant="caption" color="muted">
            Notifications poussées aux clients
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: insets.bottom + spacing.xxxl },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={history.isFetching && !history.isLoading}
            onRefresh={() => void history.refetch()}
            tintColor={palette.green}
          />
        }
      >
        <Card style={styles.section}>
          <Text variant="bodyStrong">Nouvelle campagne</Text>

          <Text variant="caption" color="muted">Type</Text>
          <View style={styles.row}>
            {CAMPAIGN_CATEGORIES.map((c) => (
              <Choix
                key={c.value}
                label={c.label}
                selected={category === c.value}
                onPress={() => setCategory(c.value)}
              />
            ))}
          </View>

          <Input
            label="Titre"
            value={title}
            onChangeText={setTitle}
            maxLength={120}
            required
          />
          <Input
            label="Message"
            value={body}
            onChangeText={setBody}
            maxLength={500}
            multiline
            required
          />
          <Input
            label="Image (facultative)"
            value={imageUrl}
            onChangeText={setImageUrl}
            autoCapitalize="none"
            keyboardType="url"
            hint="Adresse https de l'image."
          />

          <Text variant="caption" color="muted">Au toucher, ouvrir</Text>
          <View style={styles.row}>
            {CAMPAIGN_LINK_TARGETS.map((t) => (
              <Choix
                key={t.value}
                label={t.label}
                selected={linkTarget === t.value}
                onPress={() => setLinkTarget(t.value)}
              />
            ))}
          </View>
          {linkTarget !== 'information' ? (
            <Input
              label="Identifiant de la destination"
              value={linkValue}
              onChangeText={setLinkValue}
              autoCapitalize="none"
              hint="Identifiant du produit, de la catégorie ou de l’offre."
            />
          ) : null}

          {error ? <Banner tone="danger" message={error} /> : null}

          <Button
            label="Envoyer un test à mes appareils"
            variant="outline"
            loading={send.isPending}
            onPress={envoyerTest}
          />
          <Button
            label="Envoyer à tous les clients"
            loading={send.isPending}
            onPress={envoyerATous}
          />
        </Card>

        <Text variant="bodyStrong">Historique</Text>
        {history.isLoading ? (
          <Skeleton />
        ) : history.isError ? (
          <ErrorState error={history.error} onRetry={() => void history.refetch()} />
        ) : (history.data ?? []).length === 0 ? (
          <EmptyState title="Aucune campagne envoyée" />
        ) : (
          (history.data ?? []).map((campagne) => (
            <HistoryRow key={campagne.id} campagne={campagne} />
          ))
        )}
      </ScrollView>
    </View>
  );
}

/** Option à choisir (une seule active). Pill n'étant pas tactile, on l'enveloppe. */
function Choix({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <Pill label={label} tone={selected ? 'green' : 'neutral'} />
    </Pressable>
  );
}

function HistoryRow({ campagne }: { campagne: Campaign }) {
  const tone = campagne.status === 'SENT' ? 'green' : campagne.status === 'FAILED' ? 'danger' : 'neutral';
  const libelle =
    campagne.status === 'SENT' ? 'Envoyée' : campagne.status === 'FAILED' ? 'Échec' : 'En cours';
  const cible = campagne.audience === 'TEST' ? 'Test (mes appareils)' : 'Tous les clients acceptants';
  return (
    <Card style={styles.section}>
      <View style={styles.row}>
        <Text variant="bodyStrong" style={styles.flex}>{campagne.title}</Text>
        <Pill label={libelle} tone={tone} />
      </View>
      <Text variant="caption" color="muted">
        {cible} · {new Date(campagne.createdAt).toLocaleDateString('fr-FR')}
      </Text>
      <Text variant="caption">
        Destinataires : {campagne.targetCount} · Acceptés : {campagne.sentCount} · Refusés : {campagne.failedCount}
      </Text>
      {campagne.lastError ? (
        <Text variant="caption" color="muted">{campagne.lastError}</Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.white },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  backButton: { padding: spacing.xs },
  flex: { flex: 1 },
  body: { padding: spacing.lg, gap: spacing.md },
  section: { gap: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'center' },
});
