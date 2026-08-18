import { COMPANY, PROVISIONAL_PRICING, RICE_RANGES } from '@agrim/contracts';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Banner, Button, Card, Icon, Input, Pill, Text } from '@/components/ui';
import { formatDistance, formatDuration, formatWeight, formatXof } from '@/lib/format';
import { palette, spacing } from '@/theme/tokens';

/**
 * Galerie du design system.
 *
 * Écran temporaire : il sert à valider les composants sur un vrai appareil
 * avant de construire les écrans métier. Il sera remplacé par l'accueil réel
 * à la phase 7.
 */
export default function DesignSystemScreen() {
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xxxl },
      ]}
    >
      <View style={styles.header}>
        <Text variant="display">AGRIM</Text>
        <Text variant="caption" color="muted">
          {COMPANY.slogan} — design system v1
        </Text>
      </View>

      <Section title="Boutons">
        <Button label="Ajouter au panier" icon={<Icon name="shopping-cart" size={16} color="white" />} />
        <Button label="Me localiser" variant="outline" icon={<Icon name="crosshair" size={16} color="green" />} />
        <Button label="Chargement" loading />
        <Button label="Indisponible" disabled />
        <Button label="Annuler la commande" variant="danger" />
      </Section>

      <Section title="Étiquettes de statut">
        <View style={styles.row}>
          <Pill label="Livrée" tone="green" icon={<Icon name="check" size={11} color="green" />} />
          <Pill label="En transit" tone="info" />
          <Pill label="Stock faible" tone="warn" />
          <Pill label="Rupture" tone="danger" />
          <Pill label="Premium" tone="gold" />
        </View>
      </Section>

      <Section title="Bandeaux">
        <Banner
          tone="success"
          message="Livraison offerte dès 25 000 F d'achat."
          icon={<Icon name="gift" size={15} color="green" />}
        />
        <Banner
          tone="warning"
          message="Mode hors ligne — les données datent de 11:42."
          icon={<Icon name="wifi-off" size={15} color="#8A5310" />}
        />
        <Banner
          tone="danger"
          message="Stock insuffisant pour cette quantité."
          icon={<Icon name="triangle-alert" size={15} color="danger" />}
        />
      </Section>

      <Section title="Champs de saisie">
        <Input label="Téléphone" placeholder="07 00 00 00 01" keyboardType="phone-pad" required />
        <Input
          label="Point de repère"
          placeholder="En face de la pharmacie du Lac"
          hint="Le repère aide davantage le livreur que l'adresse."
        />
        <Input label="Mot de passe" secureTextEntry error="Au moins 8 caractères." />
      </Section>

      <Section title="Formatage métier">
        <Card>
          <Row label="Prix 5 kg" value={formatXof(6000)} />
          <Row label="Format" value={formatWeight(22500)} />
          <Row label="Petit format" value={formatWeight(900)} />
          <Row label="Distance" value={formatDistance(2400)} />
          <Row label="Durée" value={formatDuration(720)} />
        </Card>
      </Section>

      <Section title="Gammes RIZ BOAGNI">
        {RICE_RANGES.map((range) => (
          <Card key={range.slug} style={styles.rangeCard}>
            <View style={styles.rangeHead}>
              <Text variant="h3">{range.name}</Text>
              <Pill label={formatXof(PROVISIONAL_PRICING[range.slug][5000])} tone="gold" />
            </View>
            <Text variant="caption" color="muted">
              {range.description} — format {formatWeight(5000)}
            </Text>
          </Card>
        ))}
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="micro" color="muted">
        {title.toUpperCase()}
      </Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.rowBetween}>
      <Text variant="caption" color="muted">
        {label}
      </Text>
      <Text variant="h3">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: palette.bg,
  },
  content: {
    paddingHorizontal: spacing.lg,
    gap: spacing.xxl,
  },
  header: {
    gap: spacing.xs,
  },
  section: {
    gap: spacing.sm,
  },
  sectionBody: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  rangeCard: {
    gap: spacing.xs,
  },
  rangeHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
