import { phoneSchema, type MobileMoneyProvider } from '@agrim/contracts';
import { randomUUID } from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, describeError } from '@/api/errors';
import { useCreateGuestOrder, useGuestCartQuote } from '@/api/orders';
import { EmptyState } from '@/components/states';
import { Banner, Button, Card, Icon, Input, Text } from '@/components/ui';
import { formatXof } from '@/lib/format';
import { saveGuestPaymentAccess } from '@/lib/guestPayment';
import { useIsOnline } from '@/lib/network';
import { useCartStore, useCartTotals } from '@/store/cart';
import { palette, spacing } from '@/theme/tokens';

/** Le site propose ces deux parcours ; aucun ne demande de compte invité. */
type GuestPaymentMethod = 'CASH_ON_DELIVERY' | 'MOBILE_MONEY';

const PROVIDERS: { value: MobileMoneyProvider; label: string }[] = [
  { value: 'ORANGE_MONEY', label: 'Orange Money' },
  { value: 'MTN_MOMO', label: 'MTN MoMo' },
  { value: 'MOOV_MONEY', label: 'Moov Money' },
  { value: 'WAVE', label: 'Wave' },
];

/**
 * Checkout invité aligné sur le site : coordonnées, choix de règlement,
 * paiement sécurisé éventuel. Les prix, stocks et frais restent calculés côté
 * serveur — l'invité ne crée toujours ni compte ni mot de passe.
 */
export default function CommandeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isOnline = useIsOnline();
  const items = useCartStore((state) => state.items);
  const clearCart = useCartStore((state) => state.clear);
  const totals = useCartTotals();
  const createOrder = useCreateGuestOrder();
  const quote = useGuestCartQuote();

  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [deliveryLocation, setDeliveryLocation] = useState('');
  const [codePromo, setCodePromo] = useState('');
  const [paymentMethod, setPaymentMethod] =
    useState<GuestPaymentMethod>('CASH_ON_DELIVERY');
  const [mobileMoneyProvider, setMobileMoneyProvider] =
    useState<MobileMoneyProvider>('ORANGE_MONEY');
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef(randomUUID());

  /** Même devis serveur que le site : prix, remises et total exacts, sans
   * créer d'ordre ni réserver de stock. Les frais de livraison, eux, ne sont
   * jamais chiffrés — le site dit « À confirmer », on dit pareil. */
  const refreshQuote = async () => {
    const city = deliveryLocation.trim();
    if (!isOnline || city.length < 2 || items.length === 0) return;
    try {
      await quote.mutateAsync({
        city,
        items: items.map((item) => ({
          variantId: item.variantId,
          quantity: item.quantity,
        })),
        codePromo: codePromo.trim() ? codePromo.trim() : undefined,
        phone: phone.trim() ? phone.trim() : undefined,
      });
    } catch {
      // Le bouton de commande reste le contrôle définitif : une erreur de
      // devis ne doit pas effacer la saisie ni masquer le paiement à la livraison.
    }
  };

  const submit = async () => {
    const name = customerName.trim();
    const location = deliveryLocation.trim();
    const parsedPhone = phoneSchema.safeParse(phone);

    if (name.length < 2) {
      setError('Indiquez votre nom.');
      return;
    }
    if (!parsedPhone.success) {
      setError('Indiquez un numéro ivoirien valide.');
      return;
    }
    if (location.length < 2) {
      setError('Indiquez votre zone ou lieu de livraison.');
      return;
    }
    if (items.length === 0 || !isOnline) return;

    setError(null);
    try {
      const order = await createOrder.mutateAsync({
        customerName: name,
        phone: parsedPhone.data,
        deliveryLocation: location,
        items: items.map((item) => ({
          variantId: item.variantId,
          quantity: item.quantity,
        })),
        paymentMethod,
        mobileMoneyProvider:
          paymentMethod === 'MOBILE_MONEY' ? mobileMoneyProvider : undefined,
        codePromo: codePromo.trim() ? codePromo.trim() : undefined,
        idempotencyKey: idempotencyKey.current,
      });

      // Le panier est vidé uniquement quand la commande existe. Pour le
      // Mobile Money, la capacité temporaire est stockée AVANT de quitter vers
      // l'opérateur afin que le retour dans l'app puisse vérifier le statut.
      if (paymentMethod === 'MOBILE_MONEY') {
        if (!order.paymentAccessToken) {
          throw new Error(
            'La session de paiement est indisponible. Réessayez.',
          );
        }
        await saveGuestPaymentAccess(order.reference, order.paymentAccessToken);
      }
      clearCart();
      router.replace(
        paymentMethod === 'MOBILE_MONEY'
          ? `/paiement/${order.reference}`
          : `/confirmation/${order.reference}?payment=CASH_ON_DELIVERY`,
      );
    } catch (cause) {
      setError(describeError(cause));
      // Un refus métier signifie que le client va corriger son panier. Pour
      // une coupure réseau, la même clé est conservée contre un doublon.
      if (
        cause instanceof ApiError &&
        cause.status >= 400 &&
        cause.status < 500
      ) {
        idempotencyKey.current = randomUUID();
      }
    }
  };

  if (items.length === 0) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + spacing.lg }]}>
        <Header onBack={() => router.back()} />
        <EmptyState
          icon="shopping-cart"
          title="Votre panier est vide"
          message="Ajoutez un produit avant de commander."
          action={
            <Button
              label="Voir les produits"
              variant="outline"
              size="sm"
              fullWidth={false}
              onPress={() => router.replace('/catalogue')}
            />
          }
        />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={{ paddingTop: insets.top + spacing.md }}>
        <Header onBack={() => router.back()} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.intro}>
          <Text variant="micro" color="green" style={styles.stepLabel}>
            DERNIÈRE ÉTAPE
          </Text>
          <Text variant="h1">Livraison</Text>
          <Text variant="body" color="muted">
            Indiquez où notre équipe doit vous livrer. Aucun compte nécessaire.
          </Text>
        </View>

        {!isOnline ? (
          <Banner
            tone="warning"
            message="Pas de connexion Internet. Appelez-nous directement pour commander."
            icon={<Icon name="wifi-off" size={15} color="#8A5310" />}
          />
        ) : null}
        {error ? (
          <Banner
            tone="danger"
            message={error}
            icon={<Icon name="triangle-alert" size={15} color="danger" />}
          />
        ) : null}

        <Card style={styles.form}>
          <View style={styles.formHeading}>
            <View style={styles.formIcon}>
              <Icon name="map-pin" size={17} color="green" />
            </View>
            <View style={styles.flex}>
              <Text variant="h3">Vos coordonnées de livraison</Text>
              <Text variant="caption" color="muted">
                Le livreur vous contactera si nécessaire.
              </Text>
            </View>
          </View>
          <Input
            label="Nom"
            value={customerName}
            onChangeText={setCustomerName}
            placeholder="Votre nom"
            autoCapitalize="words"
            editable={!createOrder.isPending}
          />
          <Input
            label="Numéro de téléphone"
            value={phone}
            onChangeText={setPhone}
            placeholder="07 00 00 00 00"
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            editable={!createOrder.isPending}
          />
          <Input
            label="Zone / lieu de livraison"
            value={deliveryLocation}
            onChangeText={setDeliveryLocation}
            placeholder="Ex. Cocody Angré, près de la pharmacie"
            autoCapitalize="sentences"
            editable={!createOrder.isPending}
            onBlur={() => void refreshQuote()}
            multiline
            style={styles.location}
          />
          <Input
            label="Code promo (facultatif)"
            value={codePromo}
            onChangeText={setCodePromo}
            placeholder="Ex. BIENVENUE10"
            autoCapitalize="characters"
            editable={!createOrder.isPending}
            onBlur={() => void refreshQuote()}
            hint="Vérifié par AGRIM au moment du devis."
          />
        </Card>

        <View style={styles.paymentSection}>
          <Text variant="micro" color="muted">
            MODE DE PAIEMENT
          </Text>
          <PaymentChoice
            active={paymentMethod === 'CASH_ON_DELIVERY'}
            icon="banknote"
            title="Paiement à la livraison"
            detail="Réglez votre commande à la réception."
            onPress={() => setPaymentMethod('CASH_ON_DELIVERY')}
          />
          <PaymentChoice
            active={paymentMethod === 'MOBILE_MONEY'}
            icon="smartphone"
            title="Payer maintenant par Mobile Money"
            detail="Validation sécurisée chez l’opérateur."
            onPress={() => setPaymentMethod('MOBILE_MONEY')}
          />
          {paymentMethod === 'MOBILE_MONEY' ? (
            <View style={styles.providerList}>
              {PROVIDERS.map((provider) => {
                const active = mobileMoneyProvider === provider.value;
                return (
                  <Pressable
                    key={provider.value}
                    onPress={() => setMobileMoneyProvider(provider.value)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Payer avec ${provider.label}`}
                    style={[styles.provider, active && styles.providerActive]}
                  >
                    <Text
                      variant="caption"
                      style={{ color: active ? palette.green : palette.body }}
                    >
                      {provider.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>

        <Card style={styles.summary}>
          <View style={styles.summaryLine}>
            <Text variant="bodyStrong">
              {items.length} article{items.length > 1 ? 's' : ''}
            </Text>
            <Text variant="h2" color="green">
              {formatXof(quote.data?.subtotal ?? totals.subtotal)}
            </Text>
          </View>
          {quote.data ? (
            <>
              {/* Le site affiche « À confirmer » et n'ajoute AUCUN montant :
                  on reprend son libellé mot pour mot. */}
              <SummaryLine
                label="Livraison"
                value={quote.data.delivery.message}
              />
              {quote.data.remise > 0 ? (
                <SummaryLine
                  label={
                    quote.data.promoCode
                      ? `Remise ${quote.data.promoCode}`
                      : 'Remises appliquées'
                  }
                  value={`− ${formatXof(quote.data.remise)}`}
                />
              ) : null}
              <View style={styles.summaryDivider} />
              <SummaryLine
                label="Total à payer"
                value={formatXof(quote.data.total)}
                strong
              />
              {quote.data.promoMessage ? (
                <Banner
                  tone="warning"
                  message={quote.data.promoMessage}
                  icon={<Icon name="triangle-alert" size={15} color="#8A5310" />}
                />
              ) : null}
              <Text variant="caption" color="muted">
                Devis serveur pour {quote.data.zone}. Le total est revérifié à
                la création de la commande ; les frais de livraison sont
                confirmés par téléphone.
              </Text>
            </>
          ) : (
            <Text variant="caption" color="muted">
              Saisissez votre zone puis quittez le champ pour obtenir le total
              exact. Les frais de livraison sont confirmés par téléphone.
            </Text>
          )}
        </Card>
      </ScrollView>

      <View
        style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}
      >
        <Button
          label={
            !isOnline
              ? 'Connexion nécessaire'
              : createOrder.isPending
                ? 'Commande en cours…'
                : paymentMethod === 'MOBILE_MONEY'
                  ? 'CONTINUER VERS LE PAIEMENT'
                  : 'CONFIRMER LA COMMANDE'
          }
          disabled={!isOnline || createOrder.isPending}
          onPress={() => void submit()}
          icon={
            isOnline ? (
              <Icon name="circle-check" size={18} color="white" />
            ) : undefined
          }
        />
      </View>
    </View>
  );
}

function SummaryLine({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <View style={styles.summaryLine}>
      <Text
        variant={strong ? 'h3' : 'caption'}
        color={strong ? 'ink' : 'muted'}
      >
        {label}
      </Text>
      <Text
        variant={strong ? 'h2' : 'bodyStrong'}
        color={strong ? 'green' : 'ink'}
      >
        {value}
      </Text>
    </View>
  );
}

function PaymentChoice({
  active,
  icon,
  title,
  detail,
  onPress,
}: {
  active: boolean;
  icon: 'banknote' | 'smartphone';
  title: string;
  detail: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={title}
      accessibilityState={{ selected: active }}
      style={[styles.paymentChoice, active && styles.paymentChoiceActive]}
    >
      <View style={[styles.paymentIcon, active && styles.paymentIconActive]}>
        <Icon name={icon} size={18} color={active ? 'white' : 'green'} />
      </View>
      <View style={styles.flex}>
        <Text variant="h3" color={active ? 'green' : 'ink'}>
          {title}
        </Text>
        <Text variant="caption" color="muted">
          {detail}
        </Text>
      </View>
      <View style={[styles.radio, active && styles.radioActive]}>
        {active ? <View style={styles.radioDot} /> : null}
      </View>
    </Pressable>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Retour au panier"
        hitSlop={12}
      >
        <Icon name="arrow-left" size={20} color="ink" />
      </Pressable>
      <Text variant="h3">Commande</Text>
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
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  intro: { gap: spacing.xs },
  stepLabel: { letterSpacing: 1.4 },
  flex: { flex: 1 },
  form: { gap: spacing.md, padding: spacing.lg },
  formHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  formIcon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    backgroundColor: palette.greenSoft,
  },
  location: { minHeight: 82, paddingTop: spacing.md },
  paymentSection: { gap: spacing.sm },
  paymentChoice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 14,
    backgroundColor: palette.card,
    borderWidth: 1.5,
    borderColor: palette.line,
  },
  paymentChoiceActive: {
    borderColor: palette.green,
    backgroundColor: palette.greenSoft,
  },
  paymentIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: palette.greenSoft,
  },
  paymentIconActive: { backgroundColor: palette.green },
  radio: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: palette.line,
  },
  radioActive: { borderColor: palette.green },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: palette.green,
  },
  providerList: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  provider: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 14,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.line,
  },
  providerActive: {
    borderColor: palette.green,
    backgroundColor: palette.greenSoft,
  },
  summary: { gap: spacing.sm },
  summaryDivider: { height: 1, backgroundColor: palette.line },
  summaryLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: palette.card,
    borderTopWidth: 1,
    borderTopColor: palette.line,
  },
});
