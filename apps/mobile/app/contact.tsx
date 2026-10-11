import { useRouter } from 'expo-router';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppConfig, type PointOfSale } from '@/api/config';
import { ErrorState, Skeleton } from '@/components/states';
import { Banner, Button, Card, Icon, Text } from '@/components/ui';
import { callCompany, callMobileSupport, supportPhone } from '@/lib/contact';
import { formatPhone } from '@/lib/format';
import { useIsOnline } from '@/lib/network';
import { palette, spacing } from '@/theme/tokens';

/**
 * Contact et aide.
 *
 * Tout ce qui s'affiche ici vient de `GET /config/app` : AGRIM corrige un
 * numéro, ajoute une boutique ou réécrit une question fréquente dans
 * l'administration, et l'application suit sans nouvelle version. Aucun numéro
 * n'est écrit dans cet écran.
 *
 * Les points de vente sont affichés même quand le retrait n'est pas ouvert :
 * l'adresse reste une information utile, mais l'étiquette dit la vérité pour
 * éviter qu'un client se déplace pour rien.
 */
export default function ContactScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isOnline = useIsOnline();
  const config = useAppConfig();

  const support = config.data?.support;
  const phone = support?.phone ?? supportPhone();
  const delivery = config.data?.delivery;

  const ouvrirWhatsApp = async () => {
    const numero = support?.whatsapp;
    if (!numero) return;
    await Linking.openURL(`https://wa.me/${numero}`);
  };

  const ouvrirEmail = async () => {
    const email = support?.email;
    if (!email) return;
    await Linking.openURL(`mailto:${email}`);
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
          <Text variant="h3">Contact et aide</Text>
          <Text variant="caption" color="muted">
            Coordonnées officielles AGRIM
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: insets.bottom + spacing.xxxl },
        ]}
      >
        {config.isError ? (
          <ErrorState
            error={config.error}
            onRetry={() => void config.refetch()}
          />
        ) : null}

        {!isOnline ? (
          <Banner
            tone="warning"
            message="Pas de connexion Internet : les informations affichées peuvent dater. L’appel fonctionne malgré tout."
            icon={<Icon name="wifi-off" size={15} color="#8A5310" />}
          />
        ) : null}

        <Card style={styles.actions}>
          <View style={styles.formHeading}>
            <View style={styles.formIcon}>
              <Icon name="headset" size={17} color="green" />
            </View>
            <View style={styles.flex}>
              <Text variant="h3">Joindre AGRIM</Text>
              <Text variant="caption" color="muted">
                Appelez avec votre numéro de commande si vous en avez un.
              </Text>
            </View>
          </View>

          <Button
            label={`APPELER LE ${phone}`}
            onPress={() => void callMobileSupport()}
            icon={<Icon name="phone" size={17} color="white" />}
          />
          {config.isLoading ? <Skeleton height={20} /> : null}
          {support?.landlinePhone ? (
            <Button
              label={`STANDARD · ${support.landlinePhone}`}
              variant="outline"
              onPress={() => void callCompany()}
              icon={<Icon name="phone-call" size={17} color="green" />}
            />
          ) : null}
          {support?.whatsapp ? (
            <Button
              label="ÉCRIRE SUR WHATSAPP"
              variant="outline"
              onPress={() => void ouvrirWhatsApp()}
              icon={<Icon name="message-circle" size={17} color="green" />}
            />
          ) : null}
          {support?.email ? (
            <Button
              label={`ÉCRIRE À ${support.email}`}
              variant="outline"
              onPress={() => void ouvrirEmail()}
              icon={<Icon name="mail" size={17} color="green" />}
            />
          ) : null}
        </Card>

        <Card style={styles.section}>
          <Text variant="micro" color="muted">
            POINTS DE VENTE
          </Text>
          {config.isLoading ? (
            <>
              <Skeleton height={64} />
              <Skeleton height={64} />
            </>
          ) : (config.data?.pointsOfSale ?? []).length === 0 ? (
            <Text variant="body" color="muted">
              AGRIM n’a pas encore publié de point de vente dans
              l’application. Appelez-nous pour connaître l’adresse la plus
              proche.
            </Text>
          ) : (
            (config.data?.pointsOfSale ?? []).map((pos) => (
              <PointDeVente key={pos.id} point={pos} />
            ))
          )}
        </Card>

        <Card style={styles.section}>
          <Text variant="micro" color="muted">
            LIVRAISON
          </Text>
          {delivery ? (
            <>
              <Text variant="body" color="body">
                {delivery.summary}
              </Text>
              <Text variant="caption" color="muted">
                {delivery.delays}
              </Text>
              <Text variant="caption" color="muted">
                {delivery.pickupConditions}
              </Text>
              <Banner
                tone="info"
                message={delivery.feeNotice}
                icon={<Icon name="info" size={15} color="green" />}
              />
            </>
          ) : (
            <Text variant="body" color="muted">
              Les informations de livraison seront disponibles dès que la
              connexion revient.
            </Text>
          )}
        </Card>

        <Card style={styles.section}>
          <Text variant="micro" color="muted">
            QUESTIONS FRÉQUENTES
          </Text>
          {(config.data?.faq ?? []).length === 0 ? (
            <Text variant="body" color="muted">
              Aucune question publiée pour le moment. Appelez-nous : nous
              répondons directement.
            </Text>
          ) : (
            (config.data?.faq ?? []).map((entree) => (
              <View key={entree.question} style={styles.faq}>
                <Text variant="bodyStrong">{entree.question}</Text>
                <Text variant="caption" color="muted">
                  {entree.answer}
                </Text>
              </View>
            ))
          )}
        </Card>

        <Card style={styles.section}>
          <Text variant="micro" color="muted">
            SIGNALER UN PROBLÈME
          </Text>
          <Text variant="body" color="muted">
            Une commande qui n’arrive pas, un montant qui vous semble faux, un
            paiement déclaré mais non confirmé : appelez-nous avec votre numéro
            de commande. AGRIM retrouve le dossier et vous répond.
          </Text>
          <Button
            label="APPELER POUR SIGNALER"
            variant="outline"
            onPress={() => void callMobileSupport()}
            icon={<Icon name="alert-circle" size={17} color="green" />}
          />
        </Card>

        <Text variant="caption" color="muted" center>
          AGRIM ne vous demandera jamais votre code secret mobile money.
        </Text>
      </ScrollView>
    </View>
  );
}

/** Un point de vente tel que publié, avec l'état du retrait. */
function PointDeVente({ point }: { point: PointOfSale }) {
  return (
    <View style={styles.pos}>
      <View style={styles.posHead}>
        <Icon name="store" size={16} color="green" />
        <Text variant="bodyStrong" style={styles.flex}>
          {point.name}
        </Text>
        <Text variant="micro" color={point.supportsPickup ? 'green' : 'muted'}>
          {point.supportsPickup ? 'RETRAIT POSSIBLE' : 'INFORMATION'}
        </Text>
      </View>
      <Text variant="caption" color="muted">
        {point.address}
        {point.landmark ? ` — ${point.landmark}` : ''} · {point.city}
      </Text>
      {point.openingHours ? (
        <Text variant="caption" color="muted">
          {point.openingHours}
        </Text>
      ) : null}
      {point.phone ? (
        <Pressable
          onPress={() =>
            void Linking.openURL(`tel:${point.phone!.replace(/[\s.-]/g, '')}`)
          }
          accessibilityRole="button"
          accessibilityLabel={`Appeler ${point.name}`}
          style={styles.posPhone}
        >
          <Icon name="phone" size={14} color="green" />
          <Text variant="caption" color="green">
            {formatPhone(point.phone)}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  backButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.line,
  },
  flex: { flex: 1 },
  body: { gap: spacing.md, padding: spacing.lg },
  actions: { gap: spacing.md, padding: spacing.lg },
  formHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  formIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: palette.greenSoft,
  },
  section: { gap: spacing.sm, padding: spacing.lg },
  pos: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: palette.line,
  },
  posHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  posPhone: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  faq: { gap: spacing.xs, paddingVertical: spacing.sm },
});
