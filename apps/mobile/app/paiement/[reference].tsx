import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { describeError } from '@/api/errors';
import {
  useDeclarePayment,
  useGuestPaymentStatus,
  usePaymentInstructions,
  type DirectPaymentMethod,
} from '@/api/payments';
import { CheckoutProgress } from '@/components/CheckoutProgress';
import { Banner, Button, Card, Icon, Input, Text } from '@/components/ui';
import { callMobileSupport, supportPhone } from '@/lib/contact';
import { formatXof } from '@/lib/format';
import { getGuestPaymentAccess } from '@/lib/guestPayment';
import { useIsOnline } from '@/lib/network';
import { palette, spacing } from '@/theme/tokens';

/**
 * Paiement par TRANSFERT DIRECT vers le numéro officiel d'AGRIM.
 *
 * L'écran ne fait que trois choses, dans cet ordre :
 *
 *  1. afficher l'instruction EXACTE venue du serveur — montant figé, numéro
 *     configuré par AGRIM, bénéficiaire, référence de commande à rappeler ;
 *  2. laisser le client DÉCLARER la transaction qu'il vient d'effectuer
 *     (référence opérateur, montant transféré) ;
 *  3. suivre le statut réel : déclaré → vérification AGRIM → confirmé.
 *
 * Ce que cet écran ne fera JAMAIS : confirmer un paiement. Le bouton
 * « j'ai payé » n'existe pas ; une déclaration n'est pas une preuve, et seule
 * la vérification humaine côté AGRIM fait passer la commande à « confirmée ».
 */
export default function GuestPaymentScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isOnline = useIsOnline();
  const { reference } = useLocalSearchParams<{ reference: string }>();
  const [accessToken, setAccessToken] = useState<string | null | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | null>(null);
  const [transactionReference, setTransactionReference] = useState('');
  // `null` tant que le client n'a rien saisi : la valeur AFFICHÉE retombe alors
  // sur le montant attendu venu du serveur — sans effet de bord ni état dupliqué.
  const [declaredAmount, setDeclaredAmount] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [declared, setDeclared] = useState(false);
  const [copied, setCopied] = useState<'numero' | 'tout' | null>(null);

  const instructions = usePaymentInstructions(
    reference ?? '',
    accessToken ?? null,
  );
  const declare = useDeclarePayment(reference ?? '', accessToken ?? null);
  const payment = useGuestPaymentStatus(reference ?? '', accessToken ?? null);

  useEffect(() => {
    let active = true;
    void getGuestPaymentAccess(reference ?? '').then((token) => {
      if (active) setAccessToken(token);
    });
    return () => {
      active = false;
    };
  }, [reference]);

  // Le montant attendu pré-remplit le formulaire : le client transfère le
  // montant exact, il n'a rien à recopier de tête.
  const montantSaisi =
    declaredAmount ??
    (instructions.data ? String(instructions.data.amount) : '');

  // Confirmation réelle (par AGRIM) : on rejoint l'écran de confirmation.
  useEffect(() => {
    if (payment.data?.status !== 'SUCCEEDED' || !reference) return;
    router.replace(`/confirmation/${reference}?payment=DIRECT_MOBILE_MONEY`);
  }, [payment.data?.status, reference, router]);

  const copyNumber = async (method: DirectPaymentMethod) => {
    await Clipboard.setStringAsync(method.receivingNumber);
    setCopied('numero');
  };

  const copyAll = async () => {
    const data = instructions.data;
    if (!data) return;
    const lignes = [
      `Paiement AGRIM — commande ${data.reference}`,
      `Montant : ${formatXof(data.amount)}`,
      `${data.method.operatorName} : ${data.method.receivingNumber}`,
      data.method.beneficiaryName
        ? `Bénéficiaire : ${data.method.beneficiaryName}`
        : null,
      `Référence à indiquer : ${data.paymentReference}`,
    ].filter((ligne): ligne is string => ligne !== null);
    await Clipboard.setStringAsync(lignes.join('\n'));
    setCopied('tout');
  };

  const submitDeclaration = async () => {
    if (!reference || !accessToken || !isOnline) return;
    const montant = Number.parseInt(montantSaisi.replace(/\D/g, ''), 10);
    const valeur = transactionReference.trim();
    setError(null);

    if (valeur.length < 4) {
      setError(
        'Indiquez la référence de transaction affichée par votre opérateur (au moins 4 caractères).',
      );
      return;
    }
    if (!Number.isSafeInteger(montant) || montant <= 0) {
      setError('Indiquez le montant que vous avez transféré.');
      return;
    }

    try {
      await declare.mutateAsync({
        transactionReference: valeur,
        declaredAmount: montant,
        note: note.trim() ? note.trim() : undefined,
      });
      setDeclared(true);
      await payment.refetch();
    } catch (cause) {
      setError(describeError(cause));
    }
  };

  if (accessToken === undefined) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + spacing.xl }]}>
        <Text variant="body" color="muted" center>
          Préparation du paiement…
        </Text>
      </View>
    );
  }

  if (!accessToken) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + spacing.xl }]}>
        <View style={styles.lostAccess}>
          <Icon name="lock-keyhole" size={34} color="gold" />
          <Text variant="h1" center>
            Session de paiement expirée
          </Text>
          <Text variant="body" color="muted" center>
            Pour protéger votre commande, l’accès au paiement est limité dans le
            temps. Appelez AGRIM avec votre numéro de commande : votre dossier
            reste enregistré.
          </Text>
          <Button
            label="APPELER AGRIM"
            variant="outline"
            onPress={() => void callMobileSupport()}
            icon={<Icon name="phone" size={17} color="green" />}
          />
          <Button
            label="RETOUR AUX PRODUITS"
            onPress={() => router.replace('/catalogue')}
          />
        </View>
      </View>
    );
  }

  const data = instructions.data;
  const statut = payment.data?.status ?? data?.status ?? 'PENDING';
  const confirmed = statut === 'SUCCEEDED';
  const rejected = statut === 'REJECTED';
  const needsReview =
    statut === 'DECLARED_BY_CUSTOMER' || statut === 'UNDER_REVIEW';
  const declaredAlready = declared || needsReview || rejected || confirmed;

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Retour à la commande"
          hitSlop={12}
          style={styles.backButton}
        >
          <Icon name="arrow-left" size={19} color="ink" />
        </Pressable>
        <Text variant="h3">Paiement par transfert</Text>
      </View>
      <View style={styles.progress}>
        <CheckoutProgress step={3} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.intro}>
          <Text variant="micro" color="green" style={styles.stepLabel}>
            ÉTAPE 3 SUR 4
          </Text>
          <Text variant="h1">Effectuez le transfert</Text>
          <Text variant="body" color="muted">
            Envoyez le montant exact vers le numéro officiel d’AGRIM, puis
            déclarez votre transaction ci-dessous. AGRIM vérifie la réception
            des fonds avant de confirmer la commande.
          </Text>
        </View>

        {!isOnline ? (
          <View style={styles.offlineSupport}>
            <Banner
              tone="warning"
              message="Pas de connexion Internet. Votre paiement ne peut pas être déclaré hors connexion — ne payez jamais sans réseau, appelez AGRIM."
              icon={<Icon name="wifi-off" size={15} color="#8A5310" />}
            />
            <Button
              label={`APPELER AGRIM · ${supportPhone()}`}
              variant="outline"
              size="sm"
              fullWidth={false}
              onPress={() => void callMobileSupport()}
              icon={<Icon name="phone" size={15} color="green" />}
            />
          </View>
        ) : null}

        {error || instructions.isError ? (
          <Banner
            tone="danger"
            message={error ?? 'Les instructions de paiement sont indisponibles.'}
            icon={<Icon name="triangle-alert" size={15} color="danger" />}
          />
        ) : null}

        {confirmed ? (
          <Banner
            tone="success"
            message="Paiement confirmé par AGRIM. Votre commande est prise en charge."
            icon={<Icon name="circle-check" size={16} color="green" />}
          />
        ) : null}

        {data ? (
          <>
            <Card style={styles.amountCard}>
              <View style={styles.amountHead}>
                <View style={styles.walletIcon}>
                  <Icon name="smartphone" size={22} color="green" />
                </View>
                <View style={styles.flex}>
                  <Text variant="h3">{data.method.operatorName}</Text>
                  <Text variant="caption" color="muted">
                    Transfert vers le numéro officiel AGRIM
                  </Text>
                </View>
              </View>
              <View style={styles.divider} />
              <View style={styles.amountRow}>
                <Text variant="bodyStrong">Montant exact à envoyer</Text>
                <Text variant="h1" color="green">
                  {formatXof(data.amount)}
                </Text>
              </View>
              <View style={styles.amountRow}>
                <Text variant="caption" color="muted">
                  Référence à indiquer
                </Text>
                <Text variant="bodyStrong">{data.paymentReference}</Text>
              </View>
            </Card>

            <Card style={styles.numberCard}>
              <Text variant="micro" color="muted">
                NUMÉRO OFFICIEL DE RÉCEPTION
              </Text>
              <Text variant="h1" selectable style={styles.number}>
                {data.method.receivingNumber}
              </Text>
              {data.method.beneficiaryName ? (
                <Text variant="caption" color="muted">
                  Bénéficiaire : {data.method.beneficiaryName}
                </Text>
              ) : null}
              <Button
                label={copied === 'numero' ? 'NUMÉRO COPIÉ' : 'COPIER LE NUMÉRO'}
                variant="outline"
                size="sm"
                fullWidth={false}
                onPress={() => void copyNumber(data.method)}
                icon={<Icon name="copy" size={15} color="green" />}
              />
              {data.method.instructions ? (
                <Text variant="body" color="body">
                  {data.method.instructions}
                </Text>
              ) : null}
            </Card>

            <Button
              label={
                copied === 'tout'
                  ? 'INSTRUCTIONS COPIÉES'
                  : 'COPIER MONTANT + NUMÉRO + RÉFÉRENCE'
              }
              variant="outline"
              onPress={() => void copyAll()}
              icon={<Icon name="copy" size={17} color="green" />}
            />

            <Banner
              tone="info"
              message="AGRIM ne vous demandera JAMAIS votre code secret ni un mot de passe. Ne partagez ce code avec personne."
              icon={<Icon name="shield-check" size={15} color="green" />}
            />
          </>
        ) : null}

        {/* ── Déclaration de la transaction ─────────────────────────────── */}
        {!confirmed ? (
          <Card style={styles.form}>
            <View style={styles.formHeading}>
              <View style={styles.formIcon}>
                <Icon name="receipt" size={17} color="green" />
              </View>
              <View style={styles.flex}>
                <Text variant="h3">J’ai effectué le transfert</Text>
                <Text variant="caption" color="muted">
                  Indiquez la référence affichée par votre opérateur. Une
                  déclaration n’est pas une confirmation : AGRIM vérifie les
                  fonds reçus.
                </Text>
              </View>
            </View>

            {declared ? (
              <Banner
                tone={
                  statut === 'UNDER_REVIEW'
                    ? 'warning'
                    : statut === 'REJECTED'
                      ? 'danger'
                      : 'success'
                }
                message={
                  statut === 'UNDER_REVIEW'
                    ? 'Déclaration enregistrée. Le montant annoncé diffère du montant attendu : AGRIM vous contacte.'
                    : statut === 'REJECTED'
                      ? `AGRIM n’a pas pu confirmer ce paiement${
                          data?.rejectionNote
                            ? ` — motif : « ${data.rejectionNote} »`
                            : ''
                        }. Vérifiez la référence, ou appelez-nous : vous pouvez déclarer une autre transaction.`
                      : 'Merci. Votre déclaration est enregistrée : AGRIM vérifie la réception des fonds.'
                }
                icon={<Icon name="clock-3" size={15} color="#8A5310" />}
              />
            ) : null}

            <Input
              label="Référence de la transaction"
              value={transactionReference}
              onChangeText={setTransactionReference}
              placeholder="Ex. TX123456789"
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!declare.isPending}
              hint="Elle figure dans le message de confirmation de votre opérateur."
            />
            <Input
              label="Montant transféré (F CFA)"
              value={montantSaisi}
              onChangeText={setDeclaredAmount}
              placeholder="Ex. 18500"
              keyboardType="number-pad"
              editable={!declare.isPending}
            />
            <Input
              label="Note pour AGRIM (facultatif)"
              value={note}
              onChangeText={setNote}
              placeholder="Ex. transfert effectué à 10h30"
              editable={!declare.isPending}
              multiline
            />

            <Button
              label={
                declare.isPending
                  ? 'ENREGISTREMENT…'
                  : rejected
                    ? 'DÉCLARER UNE AUTRE TRANSACTION'
                    : declaredAlready
                      ? 'METTRE À JOUR MA DÉCLARATION'
                      : 'DÉCLARER MON TRANSFERT'
              }
              disabled={!isOnline || declare.isPending}
              onPress={() => void submitDeclaration()}
              icon={<Icon name="send" size={17} color="white" />}
            />
            <Text variant="caption" color="muted">
              Vous ne pouvez pas modifier le statut ni le montant dû : seule
              AGRIM confirme un paiement, après vérification des fonds reçus.
            </Text>
          </Card>
        ) : null}

        {needsReview ? (
          <Card style={styles.awaiting} flat>
            <Icon name="clock-3" size={20} color="goldDark" />
            <View style={styles.flex}>
              <Text variant="h3">Vérification en cours</Text>
              <Text variant="caption" color="muted">
                Vous serez prévenu dès que AGRIM aura confirmé la réception des
                fonds. Cet écran se met à jour automatiquement.
              </Text>
            </View>
          </Card>
        ) : null}

        <Button
          label="ACTUALISER LE STATUT"
          variant="outline"
          disabled={!isOnline || payment.isFetching}
          onPress={() => void payment.refetch()}
          icon={<Icon name="refresh-cw" size={16} color="green" />}
        />
      </ScrollView>
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
  progress: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  content: { gap: spacing.lg, padding: spacing.lg, paddingBottom: spacing.xxl },
  intro: { gap: spacing.xs },
  stepLabel: { letterSpacing: 1.4 },
  offlineSupport: { gap: spacing.sm, alignItems: 'flex-start' },
  amountCard: { gap: spacing.md, padding: spacing.lg },
  amountHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  walletIcon: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    backgroundColor: palette.greenSoft,
  },
  flex: { flex: 1 },
  divider: { height: 1, backgroundColor: palette.line },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  numberCard: { gap: spacing.sm, padding: spacing.lg },
  number: { letterSpacing: 1.2 },
  form: { gap: spacing.md, padding: spacing.lg },
  formHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  formIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: palette.greenSoft,
  },
  awaiting: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: palette.goldSoft,
    borderColor: '#EAD9A5',
  },
  lostAccess: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
});
