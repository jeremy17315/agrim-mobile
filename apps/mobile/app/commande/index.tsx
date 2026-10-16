import { phoneSchema } from '@agrim/contracts';
import { randomUUID } from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, describeError } from '@/api/errors';
import {
  useCreateGuestOrder,
  useDeliveryZones,
  useGuestCartQuote,
} from '@/api/orders';
import { usePaymentMethods } from '@/api/payments';
import { CheckoutProgress } from '@/components/CheckoutProgress';
import { EmptyState } from '@/components/states';
import { Banner, Button, Card, Icon, Input, Text } from '@/components/ui';
import { callMobileSupport, supportPhone } from '@/lib/contact';
import { formatXof } from '@/lib/format';
import { saveGuestPaymentAccess } from '@/lib/guestPayment';
import { useIsOnline } from '@/lib/network';
import { useCartStore, useCartTotals } from '@/store/cart';
import { palette, spacing } from '@/theme/tokens';

/**
 * Deux façons de régler, aucune ne demande de compte : à la livraison, ou par
 * transfert direct vers le numéro officiel qu'AGRIM a publié.
 *
 * La liste des opérateurs n'est PLUS écrite ici : elle est lue sur
 * `GET /payments/methods`, donc corriger un numéro ou retirer un opérateur
 * prend effet sans nouvelle version sur le Play Store — et aucun numéro
 * inventé ne peut se retrouver dans le bundle.
 */
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
  const zones = useDeliveryZones();

  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  // Le client CHOISIT sa zone, il ne la tape plus : une zone tapée à la main
  // se trompait de délai, et le site, lui, propose une liste fermée.
  const [zone, setZone] = useState('');
  const [landmark, setLandmark] = useState('');
  const [codePromo, setCodePromo] = useState('');
  const [methodCode, setMethodCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Moyens de paiement ACTIFS publiés par AGRIM. Liste vide = seul le paiement
  // à la livraison est proposé : l'application n'invente jamais un numéro.
  const methods = usePaymentMethods();
  const selectedMethod =
    (methods.data?.methods ?? []).find((m) => m.code === methodCode) ?? null;
  const idempotencyKey = useRef(randomUUID());

  /** Zone choisie + précisions éventuelles : le serveur résout la zone depuis
   * ce texte, exactement comme le site le fait depuis la ville choisie. */
  function deliveryLocation(selectedZone = zone): string {
    const details = landmark.trim();
    if (!selectedZone) return details;
    return details ? `${selectedZone} — ${details}` : selectedZone;
  }

  /** Même devis serveur que le site : prix, remises et total exacts, sans
   * créer d'ordre ni réserver de stock. Les frais de livraison, eux, ne sont
   * jamais chiffrés — le site dit « À confirmer », on dit pareil. */
  const refreshQuote = async (
    location = deliveryLocation(),
    // Le code RETIRÉ doit partir comme absent : passer une chaîne vide au
    // serveur reviendrait à lui demander d'évaluer un code vide.
    code = codePromo.trim(),
  ) => {
    const city = location.trim();
    if (!isOnline || city.length < 2 || items.length === 0) return;
    try {
      await quote.mutateAsync({
        city,
        items: items.map((item) => ({
          variantId: item.variantId,
          quantity: item.quantity,
        })),
        codePromo: code ? code : undefined,
        phone: phone.trim() ? phone.trim() : undefined,
      });
    } catch {
      // Le bouton de commande reste le contrôle définitif : une erreur de
      // devis ne doit pas effacer la saisie ni masquer le paiement à la livraison.
    }
  };

  const submit = async () => {
    const name = customerName.trim();
    const location = deliveryLocation().trim();
    const parsedPhone = phoneSchema.safeParse(phone);

    if (name.length < 2) {
      setError('Indiquez votre nom.');
      return;
    }
    if (!parsedPhone.success) {
      setError('Indiquez un numéro ivoirien valide.');
      return;
    }
    if (zone.length === 0) {
      setError('Choisissez votre zone de livraison.');
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
        paymentMethod: selectedMethod
          ? 'DIRECT_MOBILE_MONEY'
          : 'CASH_ON_DELIVERY',
        paymentMethodCode: selectedMethod?.code,
        codePromo: codePromo.trim() ? codePromo.trim() : undefined,
        idempotencyKey: idempotencyKey.current,
      });

      // Le panier est vidé uniquement quand la commande existe. Pour le
      // transfert direct, la capacité temporaire est stockée AVANT d'aller
      // chercher les instructions de paiement, afin que le retour dans
      // l'application (ou une fermeture suivie d'une réouverture) retrouve le
      // dossier sans compte.
      if (selectedMethod) {
        if (!order.paymentAccessToken) {
          throw new Error(
            'La session de paiement est indisponible. Réessayez.',
          );
        }
        await saveGuestPaymentAccess(order.reference, order.paymentAccessToken);
      }
      clearCart();
      router.replace(
        selectedMethod
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
      <View style={styles.progress}>
        <CheckoutProgress step={2} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.intro}>
          <Text variant="micro" color="green" style={styles.stepLabel}>
            ÉTAPE 2 SUR 4
          </Text>
          <Text variant="h1">Livraison</Text>
          <Text variant="body" color="muted">
            Indiquez où notre équipe doit vous livrer. Aucun compte nécessaire.
          </Text>
        </View>

        {!isOnline ? (
          <View style={styles.offlineSupport}>
            <Banner
              tone="warning"
              message="Pas de connexion Internet. Vous pouvez appeler AGRIM pour commander."
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
          <View style={styles.zoneBlock}>
            <Text variant="caption" color="muted">
              Zone de livraison
            </Text>
            <View style={styles.zoneList}>
              {(zones.data?.zones ?? []).map((option) => {
                const active = zone === option.label;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => {
                      setZone(option.label);
                      // `setZone` est asynchrone : passer la valeur choisie
                      // évite un devis sur la zone précédente au premier clic.
                      void refreshQuote(deliveryLocation(option.label));
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Livrer à ${option.label}`}
                    disabled={createOrder.isPending}
                    style={[styles.zone, active && styles.zoneActive]}
                  >
                    <Icon
                      name="map-pin"
                      size={15}
                      color={active ? 'white' : 'green'}
                    />
                    <Text
                      variant="caption"
                      style={{ color: active ? palette.white : palette.body }}
                    >
                      {option.label}
                      {option.delai ? ` · ${option.delai}` : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <Input
            label="Précisions pour le livreur (facultatif)"
            value={landmark}
            onChangeText={setLandmark}
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
            active={selectedMethod === null}
            icon="banknote"
            title="Paiement à la livraison"
            detail="Réglez votre commande à la réception."
            onPress={() => setMethodCode(null)}
          />
          {(methods.data?.methods ?? []).map((method) => (
            <PaymentChoice
              key={method.code}
              active={selectedMethod?.code === method.code}
              icon="smartphone"
              title={`Payer maintenant par ${method.operatorName}`}
              detail="Transfert vers le numéro officiel AGRIM, puis déclaration de votre transaction."
              onPress={() => setMethodCode(method.code)}
            />
          ))}
          {selectedMethod ? (
            <Text variant="caption" color="muted">
              Vous transférez {formatXof(totals.total)} vers le numéro officiel
              d’AGRIM, puis vous indiquez la référence de la transaction à
              l’étape suivante. Aucun prélèvement automatique, et AGRIM ne vous
              demandera jamais votre code secret.
            </Text>
          ) : null}
          {methods.data && methods.data.methods.length === 0 ? (
            <Banner
              tone="warning"
              message="AGRIM n’a pas encore publié de numéro mobile money. Vous pouvez commander dès maintenant et régler à la livraison."
              icon={<Icon name="info" size={15} color="#8A5310" />}
            />
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
              <Text variant="caption" color="muted">
                {quote.data.delivery.libelle} · délai estimé :{' '}
                {quote.data.delivery.delai}
              </Text>
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
              {/* Crédit de parrainage : calculé par le serveur sur le COMPTE
                  connecté, jamais sur le numéro saisi ci-dessus. Il est
                  appliqué automatiquement — le client n'a rien à activer — et
                  plafonné à ce qui reste à payer. */}
              {quote.data.credit > 0 ? (
                <SummaryLine
                  label="Crédit parrainage"
                  value={`− ${formatXof(quote.data.credit)}`}
                />
              ) : null}
              <View style={styles.summaryDivider} />
              <SummaryLine
                label="Total à payer"
                value={formatXof(quote.data.total)}
                strong
              />
              {quote.data.credit > 0 ? (
                <Text variant="caption" color="muted">
                  {quote.data.creditBalanceXof - quote.data.credit > 0
                    ? `Il vous restera ${formatXof(
                        quote.data.creditBalanceXof - quote.data.credit,
                      )} de crédit de parrainage.`
                    : 'Votre crédit de parrainage est utilisé en totalité par cette commande.'}
                </Text>
              ) : null}
              {quote.data.promoMessage || quote.data.remiseStatus === 'refused' ? (
                <Banner
                  tone={quote.data.remiseStatus === 'refused' ? 'danger' : 'warning'}
                  message={
                    quote.data.promoMessage ??
                    'Ce code promo ne peut pas être appliqué.'
                  }
                  icon={
                    <Icon name="triangle-alert" size={15} color="danger" />
                  }
                />
              ) : null}
              {quote.data.remiseStatus === 'refused' ? (
                <Button
                  label="RETIRER LE CODE PROMO"
                  variant="outline"
                  size="sm"
                  fullWidth={false}
                  onPress={() => {
                    // Le code refusé ne doit pas partir avec la commande :
                    // le serveur la refuserait (409) et le client croirait à
                    // une panne. On le retire et on redemande le devis.
                    setCodePromo('');
                    void refreshQuote(undefined, '');
                  }}
                  icon={<Icon name="x" size={15} color="green" />}
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
              Choisissez votre zone pour obtenir le total exact. Les frais de
              livraison sont confirmés par téléphone.
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
                : selectedMethod
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
  progress: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  intro: { gap: spacing.xs },
  stepLabel: { letterSpacing: 1.4 },
  offlineSupport: { gap: spacing.sm, alignItems: 'flex-start' },
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
  zoneBlock: { gap: spacing.sm },
  zoneList: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  zone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 14,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.line,
  },
  zoneActive: { borderColor: palette.green, backgroundColor: palette.green },
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
