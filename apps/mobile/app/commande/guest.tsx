import { randomUUID } from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, describeError } from '@/api/errors';
import { useCreateGuestOrder, usePickupPoints } from '@/api/orders';
import { Banner, Button, Card, Icon, Input, Text } from '@/components/ui';
import { formatXof } from '@/lib/format';
import { useCartStore, useCartTotals } from '@/store/cart';
import { palette, radius, shadow, spacing } from '@/theme/tokens';

/**
 * Checkout client invité : une seule page, deux choix de réception.
 * Aucun compte, aucune adresse enregistrée, aucun paiement n'est nécessaire
 * pour transmettre la demande à AGRIM.
 */
export default function GuestCheckoutScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const items = useCartStore((state) => state.items);
  const clearCart = useCartStore((state) => state.clear);
  const totals = useCartTotals();
  const createOrder = useCreateGuestOrder();
  const pointsQuery = usePickupPoints();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [mode, setMode] = useState<'HOME_DELIVERY' | 'PICKUP_POINT'>('HOME_DELIVERY');
  const [city, setCity] = useState('');
  const [district, setDistrict] = useState('');
  const [landmark, setLandmark] = useState('');
  const [pickupCity, setPickupCity] = useState('');
  const [pickupPointId, setPickupPointId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const idempotencyKey = useRef(randomUUID());

  const points = useMemo(() => pointsQuery.data ?? [], [pointsQuery.data]);
  const cities = useMemo(
    () => [...new Set(points.map((point) => point.city))],
    [points],
  );
  const activePickupCity = pickupCity || cities[0] || '';
  const visiblePoints = points.filter((point) => point.city === activePickupCity);
  const selectedPoint = visiblePoints.find((point) => point.id === pickupPointId) ?? null;

  const submit = async () => {
    const normalizedPhone = phone.replace(/[\s.-]/g, '');
    const targetCity = mode === 'HOME_DELIVERY' ? city.trim() : activePickupCity;
    setFormError(null);

    if (name.trim().length < 2) {
      setFormError('Indiquez votre nom pour que nous puissions vous contacter.');
      return;
    }
    if (!/^(\+225)?[0-9]{10}$/.test(normalizedPhone)) {
      setFormError('Indiquez un numéro de téléphone ivoirien à 10 chiffres.');
      return;
    }
    if (!targetCity) {
      setFormError('Indiquez votre ville ou localité.');
      return;
    }
    if (mode === 'PICKUP_POINT' && !selectedPoint) {
      setFormError('Choisissez un point de vente dans cette ville.');
      return;
    }
    if (items.length === 0) {
      setFormError('Votre panier est vide.');
      return;
    }

    try {
      const order = await createOrder.mutateAsync({
        customerName: name.trim(),
        customerPhone: normalizedPhone,
        items: items.map((item) => ({
          variantId: item.variantId,
          quantity: item.quantity,
        })),
        receptionMode: mode,
        city: targetCity,
        ...(mode === 'HOME_DELIVERY'
          ? {
              ...(district.trim() ? { district: district.trim() } : {}),
              ...(landmark.trim() ? { landmark: landmark.trim() } : {}),
            }
          : { pickupPointId: selectedPoint!.id }),
        idempotencyKey: idempotencyKey.current,
      });
      clearCart();
      router.replace(`/commande/confirmation?reference=${order.reference}`);
    } catch (error) {
      setFormError(describeError(error));
      const rejectedExplicitly =
        error instanceof ApiError && error.status >= 400 && error.status < 500;
      if (rejectedExplicitly) idempotencyKey.current = randomUUID();
    }
  };

  if (items.length === 0) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
        <Header onBack={() => router.back()} />
        <View style={styles.empty}>
          <Icon name="shopping-cart" size={32} color="green" />
          <Text variant="h2">Votre panier est vide</Text>
          <Text variant="caption" color="muted" center>
            Ajoutez des produits avant de passer la commande.
          </Text>
          <Button label="Voir les produits" size="sm" onPress={() => router.replace('/catalogue')} />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.top, { paddingTop: insets.top + spacing.md }]}>
        <Header onBack={() => router.back()} />
        <Text variant="h1" style={styles.topTitle}>Finaliser la commande</Text>
        <Text variant="caption" color="muted" style={styles.topSubtitle}>
          Pas de compte à créer. AGRIM vous appelle au numéro indiqué.
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 110 }]}
        keyboardShouldPersistTaps="handled"
      >
        {formError ? (
          <Banner
            tone="danger"
            message={formError}
            icon={<Icon name="triangle-alert" size={14} color="danger" />}
          />
        ) : null}

        <SectionTitle step="1" title="Vos coordonnées" />
        <Card style={styles.formCard}>
          <Input
            label="Votre nom"
            placeholder="Awa Koné"
            required
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />
          <Input
            label="Votre numéro de téléphone"
            placeholder="07 00 00 00 01"
            required
            keyboardType="phone-pad"
            value={phone}
            onChangeText={setPhone}
          />
        </Card>

        <SectionTitle step="2" title="Comment souhaitez-vous recevoir votre commande ?" />
        <View style={styles.choices}>
          <Choice
            active={mode === 'HOME_DELIVERY'}
            icon="truck"
            title="LIVRAISON À DOMICILE"
            hint="Je souhaite être livré"
            onPress={() => setMode('HOME_DELIVERY')}
          />
          <Choice
            active={mode === 'PICKUP_POINT'}
            icon="map-pin"
            title="RETRAIT EN POINT DE VENTE"
            hint="Je récupère ma commande"
            onPress={() => setMode('PICKUP_POINT')}
          />
        </View>

        <SectionTitle step="3" title={mode === 'HOME_DELIVERY' ? 'Votre lieu de livraison' : 'Choisissez votre point de retrait'} />
        {mode === 'HOME_DELIVERY' ? (
          <Card style={styles.formCard}>
            <Input
              label="Ville / localité"
              placeholder="Yamoussoukro"
              required
              value={city}
              onChangeText={setCity}
              autoCapitalize="words"
            />
            <Input
              label="Quartier / localité"
              placeholder="Koko"
              value={district}
              onChangeText={setDistrict}
              autoCapitalize="words"
            />
            <Input
              label="Indication d'adresse"
              placeholder="Près de la pharmacie X"
              hint="Un repère aide AGRIM à organiser la livraison."
              value={landmark}
              onChangeText={setLandmark}
            />
            <Banner
              tone="info"
              message="Frais de livraison : À CONFIRMER. AGRIM vous communiquera les modalités et le montant après confirmation."
              icon={<Icon name="info" size={14} color="info" />}
            />
          </Card>
        ) : (
          <Card style={styles.formCard}>
            <Text variant="micro" color="muted">VILLE</Text>
            {pointsQuery.isPending ? <Text variant="caption" color="muted">Chargement des villes…</Text> : null}
            {pointsQuery.isError ? (
              <Banner
                tone="danger"
                message={describeError(pointsQuery.error)}
                icon={<Icon name="triangle-alert" size={14} color="danger" />}
              />
            ) : null}
            <View style={styles.chips}>
              {cities.map((itemCity) => (
                <Pressable
                  key={itemCity}
                  onPress={() => {
                    setPickupCity(itemCity);
                    setPickupPointId(null);
                  }}
                  style={[styles.chip, itemCity === activePickupCity && styles.chipActive]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: itemCity === activePickupCity }}
                >
                  <Text variant="caption" style={{ color: itemCity === activePickupCity ? palette.white : palette.body }}>
                    {itemCity}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text variant="micro" color="muted" style={styles.pointsLabel}>POINTS DE VENTE À {activePickupCity.toUpperCase()}</Text>
            {visiblePoints.map((point) => (
              <Pressable
                key={point.id}
                onPress={() => setPickupPointId(point.id)}
                style={[styles.point, point.id === pickupPointId && styles.pointActive]}
                accessibilityRole="radio"
                accessibilityState={{ selected: point.id === pickupPointId }}
              >
                <Icon name={point.id === pickupPointId ? 'circle-check' : 'circle'} size={18} color={point.id === pickupPointId ? 'green' : 'muted'} />
                <View style={styles.flex}>
                  <Text variant="bodyStrong">{point.name}</Text>
                  {point.address ? <Text variant="caption" color="muted">{point.address}</Text> : null}
                </View>
              </Pressable>
            ))}
            {!pointsQuery.isPending && visiblePoints.length === 0 ? (
              <Text variant="caption" color="muted">Aucun point de vente publié dans cette ville pour le moment.</Text>
            ) : null}
            <Banner
              tone="success"
              message="Retrait en point de vente : aucun frais de livraison."
              icon={<Icon name="circle-check" size={14} color="green" />}
            />
          </Card>
        )}

        <SectionTitle step="4" title="Vérifiez votre commande" />
        <Card style={styles.summary}>
          <Text variant="h2">VOTRE COMMANDE</Text>
          {items.map((item) => (
            <View key={item.variantId} style={styles.summaryRow}>
              <Text variant="caption" color="body" style={styles.flex}>
                {item.productName} {item.variantLabel} × {item.quantity}
              </Text>
              <Text variant="caption">{formatXof(item.unitPrice * item.quantity)}</Text>
            </View>
          ))}
          <View style={styles.separator} />
          <View style={styles.summaryRow}>
            <Text variant="bodyStrong">Total produits</Text>
            <Text variant="h2" color="green">{formatXof(totals.subtotal)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text variant="caption" color="muted">Frais de livraison</Text>
            <Text variant="bodyStrong" color={mode === 'HOME_DELIVERY' ? 'warn' : 'green'}>
              {mode === 'HOME_DELIVERY' ? 'À CONFIRMER' : '0 FCFA'}
            </Text>
          </View>
          {mode === 'HOME_DELIVERY' ? (
            <Text variant="micro" color="muted">
              Les frais seront communiqués par AGRIM après confirmation de la commande.
            </Text>
          ) : null}
        </Card>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button
          label={createOrder.isPending ? 'Enregistrement…' : 'CONFIRMER LA COMMANDE'}
          loading={createOrder.isPending}
          disabled={createOrder.isPending}
          icon={<Icon name="check" size={16} color="white" />}
          onPress={() => void submit()}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Retour" hitSlop={12}>
        <Icon name="arrow-left" size={19} color="ink" />
      </Pressable>
      <Text variant="h3">Commander</Text>
    </View>
  );
}

function SectionTitle({ step, title }: { step: string; title: string }) {
  return (
    <View style={styles.sectionTitle}>
      <View style={styles.step}><Text variant="micro" color="white">{step}</Text></View>
      <Text variant="h2" style={styles.flex}>{title}</Text>
    </View>
  );
}

function Choice({
  active,
  icon,
  title,
  hint,
  onPress,
}: {
  active: boolean;
  icon: 'truck' | 'map-pin';
  title: string;
  hint: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.choice, active && styles.choiceActive]} accessibilityRole="radio" accessibilityState={{ selected: active }}>
      <Icon name={icon} size={21} color={active ? 'green' : 'muted'} />
      <View style={styles.flex}><Text variant="bodyStrong">{title}</Text><Text variant="caption" color="muted">{hint}</Text></View>
      <Icon name={active ? 'circle-check' : 'circle'} size={18} color={active ? 'green' : 'muted'} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  top: { backgroundColor: palette.bg },
  topTitle: { paddingHorizontal: spacing.lg },
  topSubtitle: { paddingHorizontal: spacing.lg, marginTop: spacing.xs, marginBottom: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  content: { padding: spacing.lg, gap: spacing.lg },
  formCard: { gap: spacing.md },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  step: { width: 24, height: 24, borderRadius: 12, backgroundColor: palette.green, alignItems: 'center', justifyContent: 'center' },
  choices: { gap: spacing.sm },
  choice: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1.5, borderColor: palette.line, backgroundColor: palette.card },
  choiceActive: { borderColor: palette.green, backgroundColor: '#FCFEFB' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.card },
  chipActive: { backgroundColor: palette.green, borderColor: palette.green },
  pointsLabel: { marginTop: spacing.sm },
  point: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: palette.line, backgroundColor: palette.card },
  pointActive: { borderColor: palette.green, backgroundColor: '#FCFEFB' },
  summary: { gap: spacing.sm },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  separator: { height: 1, backgroundColor: palette.line },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, backgroundColor: palette.card, borderTopWidth: 1, borderTopColor: palette.line, ...shadow.floating },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg },
  flex: { flex: 1 },
});
