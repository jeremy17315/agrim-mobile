import { phoneSchema } from '@agrim/contracts';
import { randomUUID } from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, describeError } from '@/api/errors';
import { useCreateGuestOrder } from '@/api/orders';
import { EmptyState } from '@/components/states';
import { Banner, Button, Card, Icon, Input, Text } from '@/components/ui';
import { formatXof } from '@/lib/format';
import { useIsOnline } from '@/lib/network';
import { useCartStore, useCartTotals } from '@/store/cart';
import { palette, spacing } from '@/theme/tokens';

/**
 * Checkout invité : volontairement trois champs. Les prix, stocks et frais de
 * livraison sont recalculés par le serveur — le client n'a rien d'autre à
 * configurer et n'a surtout pas besoin de créer un compte.
 */
export default function CommandeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isOnline = useIsOnline();
  const items = useCartStore((state) => state.items);
  const clearCart = useCartStore((state) => state.clear);
  const totals = useCartTotals();
  const createOrder = useCreateGuestOrder();

  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [deliveryLocation, setDeliveryLocation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef(randomUUID());

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
        idempotencyKey: idempotencyKey.current,
      });
      clearCart();
      router.replace(`/confirmation/${order.reference}`);
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
            multiline
            style={styles.location}
          />
        </Card>

        <Card style={styles.paymentInfo} flat>
          <View style={styles.paymentIcon}>
            <Icon name="banknote" size={18} color="green" />
          </View>
          <View style={styles.flex}>
            <Text variant="h3">Paiement à la livraison</Text>
            <Text variant="caption" color="muted">
              Réglez votre commande à la réception.
            </Text>
          </View>
          <Icon name="circle-check" size={18} color="green" />
        </Card>

        <Card style={styles.summary}>
          <View style={styles.summaryLine}>
            <Text variant="bodyStrong">
              {items.length} article{items.length > 1 ? 's' : ''}
            </Text>
            <Text variant="h2" color="green">
              {formatXof(totals.subtotal)}
            </Text>
          </View>
          <Text variant="caption" color="muted">
            Les frais de livraison et le total final sont confirmés selon votre
            zone, avant préparation de la commande.
          </Text>
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
  paymentInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: palette.goldSoft,
    borderColor: '#EAD9A5',
  },
  paymentIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: palette.card,
  },
  summary: { gap: spacing.sm },
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
