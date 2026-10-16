import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePaymentMethods, type DirectPaymentMethod } from '@/api/payments';
import { PaymentQr } from '@/components/PaymentQr';
import { ErrorState, Skeleton } from '@/components/states';
import { Banner, Button, Icon, Text } from '@/components/ui';
import { callMobileSupport, supportPhone } from '@/lib/contact';
import { formatPhone } from '@/lib/format';
import { useIsOnline } from '@/lib/network';
import { palette, radius, spacing } from '@/theme/tokens';

/**
 * Payer AGRIM — comptes marchands et QR.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Un client qui paie par transfert direct a deux gestes possibles : recopier
 * le numéro, ou SCANNER le QR du compte marchand. Cet écran donne les deux,
 * pour MTN MoMo, Orange Money et Wave, avec les numéros officiels tels
 * qu'AGRIM les a publiés — ils ne sont jamais écrits dans l'application.
 *
 * Deux règles tenues ici :
 *  1. **Aucun compte n'est fabriqué.** Sans publication côté AGRIM, l'écran le
 *     dit et renvoie vers l'appel — jamais vers un numéro inventé.
 *  2. **Aucun QR n'est fabriqué non plus.** Le QR affiché est le contenu
 *     publié, réencodé tel quel ; sans contenu, l'emplacement reste vide et
 *     l'écran le dit.
 *
 * La page est PUBLIQUE (aucun compte requis) : un invité qui paie sa commande
 * doit pouvoir vérifier où il envoie son argent.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function MoyensDePaiementScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isOnline = useIsOnline();
  const methods = usePaymentMethods();
  const [copied, setCopied] = useState<string | null>(null);

  const liste = methods.data?.methods ?? [];

  const copierNumero = async (method: DirectPaymentMethod) => {
    await Clipboard.setStringAsync(method.receivingNumber);
    setCopied(method.code);
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
          <Text variant="h3">Payer AGRIM</Text>
          <Text variant="caption" color="muted">
            Comptes marchands officiels et QR
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: insets.bottom + spacing.xxxl },
        ]}
      >
        {methods.isError ? (
          <ErrorState
            error={methods.error}
            onRetry={() => void methods.refetch()}
          />
        ) : null}

        {!isOnline ? (
          <Banner
            tone="warning"
            message="Pas de connexion Internet : les numéros affichés peuvent dater. Vérifiez-les avant d’envoyer de l’argent."
            icon={<Icon name="wifi-off" size={15} color="#8A5310" />}
          />
        ) : null}

        <Banner
          tone="info"
          message="Transférez le montant exact vers le compte marchand, puis déclarez la transaction depuis votre commande. AGRIM vérifie la réception réelle des fonds avant de confirmer."
          icon={<Icon name="info" size={15} color="info" />}
        />

        {methods.isLoading ? (
          <>
            <Skeleton height={120} />
            <Skeleton height={120} />
          </>
        ) : null}

        {!methods.isLoading && liste.length === 0 ? (
          <View style={styles.bloc}>
            <Text variant="body" color="muted">
              AGRIM n’a pas encore publié de compte marchand dans
              l’application. Payez à la livraison, ou appelez-nous : nous vous
              donnons le numéro officiel de vive voix.
            </Text>
            <Button
              label={`APPELER AGRIM · ${supportPhone()}`}
              variant="outline"
              onPress={() => void callMobileSupport()}
              icon={<Icon name="phone" size={17} color="green" />}
            />
          </View>
        ) : null}

        {liste.map((method) => (
          <View key={method.code} style={styles.bloc}>
            <View style={styles.entete}>
              <View style={styles.rond}>
                <Icon name="qr-code" size={18} color="green" />
              </View>
              <View style={styles.flex}>
                <Text variant="h3">{method.operatorName}</Text>
                {method.beneficiaryName ? (
                  <Text variant="caption" color="muted">
                    Bénéficiaire : {method.beneficiaryName}
                  </Text>
                ) : null}
              </View>
            </View>

            <Text variant="micro" color="muted">
              NUMÉRO OFFICIEL DE RÉCEPTION
            </Text>
            <Text variant="h1" selectable>
              {method.receivingNumber}
            </Text>

            <Button
              label={
                copied === method.code ? 'NUMÉRO COPIÉ' : 'COPIER LE NUMÉRO'
              }
              variant="outline"
              size="sm"
              fullWidth={false}
              onPress={() => void copierNumero(method)}
              icon={<Icon name="copy" size={15} color="green" />}
            />

            {method.instructions ? (
              <Text variant="body" color="body">
                {method.instructions}
              </Text>
            ) : null}

            {method.qrPayload ? (
              <PaymentQr
                payload={method.qrPayload}
                operatorName={method.operatorName}
              />
            ) : (
              // Aucun QR publié pour ce compte : on le dit, plutôt que
              // d'afficher un carré vide ou un QR d'un autre compte.
              <Text variant="caption" color="muted">
                Le QR de ce compte n’est pas encore publié. Recopiez le numéro
                ci-dessus, ou demandez-nous le QR officiel.
              </Text>
            )}
          </View>
        ))}

        <Text variant="caption" color="muted">
          Seuls les comptes affichés ici sont ceux d’AGRIM. Ne transférez jamais
          sur un numéro reçu par message ou par téléphone.
        </Text>

        <Banner
          tone="warning"
          message="AGRIM ne vous demandera JAMAIS votre code secret, ni un mot de passe, ni de valider une demande de paiement reçue par SMS."
          icon={<Icon name="shield-check" size={15} color="#8A5310" />}
        />

        <Button
          label={`APPELER AGRIM · ${formatPhone(supportPhone())}`}
          variant="outline"
          onPress={() => void callMobileSupport()}
          icon={<Icon name="phone" size={17} color="green" />}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: palette.bg, flex: 1 },
  header: {
    alignItems: 'center',
    backgroundColor: palette.bg,
    borderBottomColor: palette.line,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  backButton: {
    alignItems: 'center',
    backgroundColor: palette.card,
    borderColor: palette.line,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  body: {
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  bloc: {
    backgroundColor: palette.card,
    borderColor: palette.line,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.lg,
  },
  entete: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  rond: {
    alignItems: 'center',
    backgroundColor: palette.greenSoft,
    borderRadius: radius.pill,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  flex: { flex: 1 },
});
