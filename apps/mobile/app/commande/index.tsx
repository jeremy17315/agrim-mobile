import { PAYMENT_METHODS, type PaymentMethod } from '@agrim/contracts';
import { randomUUID } from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, describeError } from '@/api/errors';
import { useAddresses, useCreateOrder } from '@/api/orders';
import { EmptyState, ErrorState, Skeleton } from '@/components/states';
import { Banner, Button, Card, Icon, Text } from '@/components/ui';
import { formatXof } from '@/lib/format';
import { useCartStore, useCartTotals } from '@/store/cart';
import { palette, radius, shadow, spacing } from '@/theme/tokens';

/**
 * Validation de commande.
 *
 * Le total affiché ici reste indicatif : c'est le serveur qui recalcule les
 * montants à partir de ses propres prix. En cas d'écart (un tarif a changé
 * depuis l'ajout au panier), c'est le montant serveur qui s'impose et
 * l'écran de confirmation l'affiche.
 */

const PAYMENT_LABELS: Record<PaymentMethod, { label: string; hint: string }> = {
  CASH_ON_DELIVERY: {
    label: 'Paiement à la livraison',
    hint: 'Réglez en espèces au livreur',
  },
  MOBILE_MONEY: {
    label: 'Mobile Money',
    hint: 'Bientôt disponible',
  },
  CARD: {
    label: 'Carte bancaire',
    hint: 'Bientôt disponible',
  },
};

/** Seul le paiement à la livraison est actif en V1 : aucun agrégateur branché. */
const AVAILABLE_METHODS: PaymentMethod[] = ['CASH_ON_DELIVERY'];

export default function CommandeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const items = useCartStore((s) => s.items);
  const clearCart = useCartStore((s) => s.clear);
  const totals = useCartTotals();

  const addresses = useAddresses();
  const createOrder = useCreateOrder();

  const [addressId, setAddressId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethod>('CASH_ON_DELIVERY');
  const [submitError, setSubmitError] = useState<string | null>(null);

  /**
   * Clé d'idempotence stable pour CETTE tentative de commande. Si le réseau
   * coupe et que l'utilisateur retente, le serveur reconnaît la clé et renvoie
   * la commande déjà créée au lieu d'en créer une seconde.
   */
  const idempotencyKey = useRef(randomUUID());

  const selectedAddress = useMemo(() => {
    const list = addresses.data ?? [];
    if (addressId) return list.find((a) => a.id === addressId) ?? null;
    return list.find((a) => a.isDefault) ?? list[0] ?? null;
  }, [addresses.data, addressId]);

  const submit = async () => {
    if (!selectedAddress || items.length === 0) return;
    setSubmitError(null);

    try {
      const order = await createOrder.mutateAsync({
        addressId: selectedAddress.id,
        items: items.map((i) => ({
          variantId: i.variantId,
          quantity: i.quantity,
        })),
        paymentMethod,
        idempotencyKey: idempotencyKey.current,
      });

      // Le panier n'est vidé qu'APRÈS confirmation serveur : en cas d'échec,
      // l'utilisateur retrouve ses articles.
      clearCart();
      router.replace(`/commande/${order.reference}`);
    } catch (error) {
      setSubmitError(describeError(error));

      // On ne renouvelle la clé QUE si le serveur a explicitement rejeté la
      // demande (stock, adresse, validation) : le panier va changer, c'est une
      // nouvelle commande. En cas d'échec réseau ou serveur, la commande a
      // peut-être été enregistrée sans que la réponse nous parvienne : garder
      // la même clé permet de retenter sans risquer un doublon.
      const rejectedByServer =
        error instanceof ApiError && error.status >= 400 && error.status < 500;
      if (rejectedByServer) {
        idempotencyKey.current = randomUUID();
      }
    }
  };

  if (items.length === 0) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
        <Header onBack={() => router.back()} title="Commander" />
        <EmptyState
          icon="shopping-cart"
          title="Votre panier est vide"
          message="Ajoutez des articles avant de commander."
          action={
            <Button
              label="Voir le catalogue"
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
        <Header onBack={() => router.back()} title="Commander" />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {submitError ? (
          <Banner
            tone="danger"
            message={submitError}
            icon={<Icon name="triangle-alert" size={14} color="danger" />}
          />
        ) : null}

        {/* Adresse ------------------------------------------------------- */}
        <View style={styles.section}>
          <Text variant="micro" color="muted">
            ADRESSE DE LIVRAISON
          </Text>

          {addresses.isPending ? (
            <Skeleton height={78} />
          ) : addresses.isError ? (
            <ErrorState
              error={addresses.error}
              onRetry={() => void addresses.refetch()}
            />
          ) : (addresses.data?.length ?? 0) === 0 ? (
            <Card style={styles.emptyAddress}>
              <Text variant="caption" color="muted">
                Aucune adresse enregistrée. Ajoutez-en une pour être livré.
              </Text>
              <Button
                label="Ajouter une adresse"
                variant="outline"
                size="sm"
                icon={<Icon name="plus" size={14} color="green" />}
                onPress={() => router.push('/commande/adresse')}
              />
            </Card>
          ) : (
            <>
              {addresses.data.map((address) => {
                const active = selectedAddress?.id === address.id;
                return (
                  <Pressable
                    key={address.id}
                    onPress={() => setAddressId(address.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Livrer à ${address.label}, ${address.city}`}
                    style={[styles.address, active && styles.addressActive]}
                  >
                    <View style={styles.addressHead}>
                      <Icon
                        name={active ? 'circle-check' : 'circle'}
                        size={17}
                        color={active ? 'green' : 'muted'}
                      />
                      <Text variant="bodyStrong" style={styles.flex}>
                        {address.label}
                      </Text>
                      {address.isDefault ? (
                        <Text variant="micro" color="green">
                          PAR DÉFAUT
                        </Text>
                      ) : null}
                    </View>
                    <Text variant="caption" color="body">
                      {[address.commune, address.city]
                        .filter(Boolean)
                        .join(', ')}
                    </Text>
                    {address.landmark ? (
                      <Text variant="caption" color="muted">
                        Repère : {address.landmark}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}

              <Pressable
                onPress={() => router.push('/commande/adresse')}
                accessibilityRole="button"
                style={styles.addAddress}
              >
                <Icon name="plus" size={15} color="green" />
                <Text variant="caption" color="green">
                  Ajouter une autre adresse
                </Text>
              </Pressable>
            </>
          )}
        </View>

        {/* Paiement ------------------------------------------------------ */}
        <View style={styles.section}>
          <Text variant="micro" color="muted">
            MOYEN DE PAIEMENT
          </Text>
          {PAYMENT_METHODS.map((method) => {
            const enabled = AVAILABLE_METHODS.includes(method);
            const active = paymentMethod === method;
            return (
              <Pressable
                key={method}
                disabled={!enabled}
                onPress={() => setPaymentMethod(method)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active, disabled: !enabled }}
                accessibilityLabel={PAYMENT_LABELS[method].label}
                style={[
                  styles.address,
                  active && styles.addressActive,
                  !enabled && styles.disabled,
                ]}
              >
                <View style={styles.addressHead}>
                  <Icon
                    name={active ? 'circle-check' : 'circle'}
                    size={17}
                    color={active ? 'green' : 'muted'}
                  />
                  <Text variant="bodyStrong" style={styles.flex}>
                    {PAYMENT_LABELS[method].label}
                  </Text>
                </View>
                <Text variant="caption" color="muted">
                  {PAYMENT_LABELS[method].hint}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Récapitulatif ------------------------------------------------- */}
        <View style={styles.section}>
          <Text variant="micro" color="muted">
            RÉCAPITULATIF
          </Text>
          <Card style={styles.summary}>
            {items.map((item) => (
              <View key={item.variantId} style={styles.summaryLine}>
                <Text variant="caption" color="body" style={styles.flex}>
                  {item.quantity} × {item.productName} ({item.variantLabel})
                </Text>
                <Text variant="caption">
                  {formatXof(item.unitPrice * item.quantity)}
                </Text>
              </View>
            ))}

            <View style={styles.separator} />

            <View style={styles.summaryLine}>
              <Text variant="caption" color="muted">
                Sous-total
              </Text>
              <Text variant="bodyStrong">{formatXof(totals.subtotal)}</Text>
            </View>
            <View style={styles.summaryLine}>
              <Text variant="caption" color="muted">
                Livraison
              </Text>
              <Text
                variant="bodyStrong"
                color={totals.deliveryFee === 0 ? 'green' : 'ink'}
              >
                {totals.deliveryFee === 0
                  ? 'Offerte'
                  : formatXof(totals.deliveryFee)}
              </Text>
            </View>

            <View style={styles.separator} />

            <View style={styles.summaryLine}>
              <Text variant="h3">Total</Text>
              <Text variant="h1" color="green">
                {formatXof(totals.total)}
              </Text>
            </View>

            <Text variant="micro" color="muted">
              Montant définitif confirmé par AGRIM à la validation.
            </Text>
          </Card>
        </View>
      </ScrollView>

      <View
        style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}
      >
        <Button
          label={
            createOrder.isPending ? 'Validation…' : 'Confirmer ma commande'
          }
          disabled={createOrder.isPending || !selectedAddress}
          icon={<Icon name="check" size={16} color="white" />}
          onPress={() => void submit()}
        />
        {!selectedAddress && !addresses.isPending ? (
          <Text variant="micro" color="muted" center>
            Choisissez une adresse de livraison pour continuer.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function Header({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <View style={styles.header}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Retour"
        hitSlop={12}
      >
        <Icon name="arrow-left" size={19} color="ink" />
      </Pressable>
      <Text variant="h3">{title}</Text>
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
    gap: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  section: { gap: spacing.sm },
  flex: { flex: 1 },

  address: {
    gap: 3,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: palette.line,
    backgroundColor: palette.card,
  },
  addressActive: { borderColor: palette.green, backgroundColor: '#FCFEFB' },
  addressHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  disabled: { opacity: 0.5 },
  emptyAddress: { gap: spacing.md, alignItems: 'flex-start' },
  addAddress: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },

  summary: { gap: spacing.sm },
  summaryLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  separator: { height: 1, backgroundColor: palette.line },

  footer: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: palette.card,
    borderTopWidth: 1,
    borderTopColor: palette.line,
    ...shadow.floating,
  },
});
