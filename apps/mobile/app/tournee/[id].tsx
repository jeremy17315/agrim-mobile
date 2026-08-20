import {
  useDelivery,
  useOtpStatus,
  useUpdateDeliveryStatus,
  useVerifyOtp,
  type Delivery,
} from '@/api/deliveries';
import { MapView, boundsOf, type MapMarker } from '@/components/map';
import { ErrorState, Skeleton } from '@/components/states';
import { Button, Card, Icon, Input, Pill, Text } from '@/components/ui';
import { formatXof } from '@/lib/format';
import { useCourierTracking } from '@/lib/useCourierTracking';
import { palette, radius, spacing } from '@/theme/tokens';
import {
  DELIVERY_OTP_CONFIG,
  type CourierSettableDeliveryStatus,
} from '@agrim/contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Détail d'une course.
 *
 * L'écran ne décide jamais d'un statut : il propose l'action suivante et
 * laisse le serveur trancher. La livraison se clôt UNIQUEMENT par la saisie du
 * code dicté par le client — aucune validation manuelle n'existe ici, et le
 * backend refuserait de toute façon un DELIVERED venu du terrain.
 */

/** Action proposée pour l'état courant. Absente : rien à faire. */
const NEXT_ACTION: Partial<
  Record<
    Delivery['status'],
    { label: string; status: CourierSettableDeliveryStatus }
  >
> = {
  ASSIGNED: { label: 'Accepter la course', status: 'ACCEPTED' },
  ACCEPTED: { label: 'Démarrer la livraison', status: 'IN_TRANSIT' },
  IN_TRANSIT: { label: 'Je suis arrivé chez le client', status: 'ARRIVED' },
};

export default function CourseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const query = useDelivery(id ?? '');
  const statusMutation = useUpdateDeliveryStatus(id ?? '');
  const otpMutation = useVerifyOtp(id ?? '');

  const [code, setCode] = useState('');
  const [otpError, setOtpError] = useState<string | null>(null);
  const tracking = useCourierTracking(id ?? '');
  const otpStatus = useOtpStatus(id ?? '');
  const [isDeclaringFailure, setDeclaringFailure] = useState(false);
  const [failureReason, setFailureReason] = useState('');

  const delivery = query.data;

  /**
   * Le GPS ne tourne que pendant le trajet : il démarre au départ et s'arrête
   * dès que la course est close. La permission n'est donc jamais demandée à
   * l'ouverture de l'écran. Elle ne conditionne pas la validation.
   */
  const isRolling =
    delivery?.status === 'IN_TRANSIT' || delivery?.status === 'ARRIVED';

  const { start: startTracking, stop: stopTracking } = tracking;
  const isTracking = tracking.isTracking;
  const permissionDenied = tracking.hasPermission === false;

  useEffect(() => {
    // Dépendances réduites aux valeurs stables : passer l'objet `tracking`
    // entier relancerait le GPS à chaque rendu.
    if (isRolling && !isTracking && !permissionDenied) {
      void startTracking();
    }
    if (!isRolling && isTracking) {
      stopTracking();
    }
  }, [isRolling, isTracking, permissionDenied, startTracking, stopTracking]);

  /**
   * Saisie du code client.
   *
   * L'application ne connaît pas le code : elle ne vérifie que la forme
   * (4 chiffres) pour éviter un aller-retour réseau inutile. Le verdict
   * appartient au serveur, qui contrôle aussi l'expiration, les tentatives et
   * l'habilitation du livreur.
   */
  const submitOtp = useCallback(async () => {
    if (!delivery) return;
    setOtpError(null);

    // Position jointe si elle est déjà connue, jamais attendue : le GPS
    // documente la remise, il ne la conditionne pas.
    const last = tracking.lastPosition;

    try {
      await otpMutation.mutateAsync({
        code,
        position: last
          ? { latitude: last.latitude, longitude: last.longitude }
          : undefined,
      });
      setCode('');
      router.back();
    } catch (error) {
      setOtpError(
        error instanceof Error
          ? error.message
          : 'Code refusé. Vérifiez auprès du client.',
      );
      setCode('');
    }
  }, [delivery, code, otpMutation, tracking.lastPosition, router]);

  /**
   * Déclaration d'échec.
   *
   * `Alert.prompt` n'existe que sur iOS : le motif serait impossible à saisir
   * sur Android. On ouvre donc un champ dans l'écran, identique sur les deux
   * plateformes.
   */
  const confirmFailure = useCallback(() => {
    const reason = failureReason.trim();
    if (reason.length === 0) return;
    Alert.alert(
      'Livraison impossible',
      'Confirmez-vous l’échec de cette course ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Confirmer',
          style: 'destructive',
          onPress: () => {
            statusMutation.mutate(
              { status: 'FAILED', failureReason: reason },
              { onSuccess: () => router.back() },
            );
          },
        },
      ],
    );
  }, [failureReason, statusMutation, router]);

  if (query.isPending) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
        <Skeleton height={120} />
        <Skeleton height={200} />
      </View>
    );
  }

  if (query.isError || !delivery) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </View>
    );
  }

  const destinationPoint =
    delivery.address.latitude !== null && delivery.address.longitude !== null
      ? {
          latitude: delivery.address.latitude,
          longitude: delivery.address.longitude,
        }
      : null;

  const courseMarkers: MapMarker[] = destinationPoint
    ? [
        {
          id: 'destination',
          ...destinationPoint,
          kind: 'destination',
          title: delivery.address.label,
        },
      ]
    : [];

  const action = NEXT_ACTION[delivery.status];
  // Le code ne se saisit qu'une fois sur place : c'est le moment de la remise.
  const canEnterCode = delivery.status === 'ARRIVED';
  const isClosed =
    delivery.status === 'DELIVERED' || delivery.status === 'FAILED';
  const isCodeComplete = code.length === DELIVERY_OTP_CONFIG.length;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + spacing.md,
          paddingBottom: insets.bottom + spacing.xxl,
        },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Retour"
          hitSlop={12}
        >
          <Icon name="arrow-left" size={22} color="ink" />
        </Pressable>
        <Text variant="h1">{delivery.order.reference}</Text>
      </View>

      {/* Adresse et contact : les deux informations qui font avancer la course. */}
      <Card style={styles.card}>
        <Text variant="h3">Adresse de livraison</Text>
        <Text variant="body" color="body">
          {delivery.address.label}
        </Text>
        <Text variant="body" color="body">
          {[delivery.address.commune, delivery.address.city]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        {delivery.address.landmark ? (
          <View style={styles.row}>
            <Icon name="milestone" size={15} color="muted" />
            <Text variant="caption" color="muted" style={styles.flex}>
              {delivery.address.landmark}
            </Text>
          </View>
        ) : null}
        {delivery.address.instructions ? (
          <Text variant="caption" color="muted">
            {delivery.address.instructions}
          </Text>
        ) : null}

        <View style={styles.addressActions}>
          {delivery.address.contactPhone ? (
            <Button
              label="Appeler le client"
              variant="outline"
              size="sm"
              fullWidth={false}
              onPress={() =>
                void Linking.openURL(`tel:${delivery.address.contactPhone}`)
              }
            />
          ) : null}
          {destinationPoint ? (
            <Button
              label="Naviguer"
              variant="outline"
              size="sm"
              fullWidth={false}
              icon={<Icon name="route" size={14} color="green" />}
              onPress={() =>
                void Linking.openURL(
                  `https://www.google.com/maps/dir/?api=1&destination=${destinationPoint.latitude},${destinationPoint.longitude}`,
                )
              }
            />
          ) : null}
        </View>
      </Card>

      <Card style={styles.card}>
        <Text variant="h3">Colis</Text>
        {delivery.order.items.map((item) => (
          <View key={item.id} style={styles.itemRow}>
            <Text variant="body" color="body" style={styles.flex}>
              {item.productName} · {item.variantLabel}
            </Text>
            <Text variant="body">×{item.quantity}</Text>
          </View>
        ))}
        <View style={styles.total}>
          <Text variant="body" color="body">
            Total
          </Text>
          <Text variant="h3" color="green">
            {formatXof(delivery.order.total)}
          </Text>
        </View>
      </Card>

      {/* Itinéraire : carte affichée pendant le trajet, avec l'état réel de
          l'émission GPS — un livreur doit savoir si sa position remonte. */}
      {isRolling ? (
        <Card style={styles.card}>
          <View style={styles.trackingHeader}>
            <Text variant="h3">Itinéraire</Text>
            <View style={styles.row}>
              <Icon
                name={isTracking ? 'satellite-dish' : 'satellite'}
                size={14}
                color={isTracking ? 'green' : 'muted'}
              />
              <Text variant="micro" color={isTracking ? 'green' : 'muted'}>
                {isTracking ? 'Position émise' : 'Suivi inactif'}
              </Text>
            </View>
          </View>

          {destinationPoint ? (
            <MapView
              viewport={
                boundsOf([destinationPoint]) ?? {
                  center: destinationPoint,
                }
              }
              markers={courseMarkers}
              height={180}
            />
          ) : (
            <Text variant="caption" color="muted">
              Cette adresse n’a pas de coordonnées GPS. Utilisez le repère
              indiqué ci-dessus.
            </Text>
          )}

          {permissionDenied ? (
            <Text variant="caption" color="danger">
              Localisation refusée : le client ne verra pas votre progression.
            </Text>
          ) : null}

          {tracking.queuedCount > 0 ? (
            <Text variant="micro" color="muted">
              {tracking.queuedCount} position
              {tracking.queuedCount > 1 ? 's' : ''} en attente de réseau
            </Text>
          ) : null}
        </Card>
      ) : null}

      {/* Validation : seule la saisie du code remis par le client clôt la
          course. Aucun bouton ne permet de s'en passer. */}
      {canEnterCode ? (
        <Card style={styles.card}>
          <Text variant="h3">Code de livraison</Text>
          <Text variant="caption" color="muted">
            Demandez au client le code à {DELIVERY_OTP_CONFIG.length} chiffres
            reçu dans son application, puis saisissez-le ci-dessous.
          </Text>

          <Input
            label="Code du client"
            placeholder="0000"
            value={code}
            onChangeText={(value) => {
              // Seuls les chiffres, longueur bornée : la saisie ne peut pas
              // produire une valeur que le serveur rejetterait sur la forme.
              setCode(
                value
                  .replace(/[^0-9]/g, '')
                  .slice(0, DELIVERY_OTP_CONFIG.length),
              );
              setOtpError(null);
            }}
            keyboardType="number-pad"
            maxLength={DELIVERY_OTP_CONFIG.length}
            autoFocus
          />

          {otpError ? (
            <Text variant="caption" color="danger">
              {otpError}
            </Text>
          ) : null}

          {otpStatus.data && !otpStatus.data.isActive ? (
            <Text variant="caption" color="warn">
              Aucun code actif. Demandez au client de le faire renvoyer depuis
              le suivi de sa commande.
            </Text>
          ) : null}

          {otpStatus.data?.isActive && otpStatus.data.attemptsRemaining <= 2 ? (
            <Text variant="caption" color="warn">
              {otpStatus.data.attemptsRemaining} tentative
              {otpStatus.data.attemptsRemaining > 1 ? 's' : ''} restante
              {otpStatus.data.attemptsRemaining > 1 ? 's' : ''}.
            </Text>
          ) : null}

          <Button
            label="Valider la livraison"
            onPress={() => void submitOtp()}
            loading={otpMutation.isPending}
            disabled={!isCodeComplete}
          />
        </Card>
      ) : null}

      {isClosed ? (
        <Card style={styles.card}>
          <Pill
            tone={delivery.status === 'DELIVERED' ? 'green' : 'danger'}
            label={delivery.status === 'DELIVERED' ? 'Livrée' : 'Échec'}
          />
          {delivery.failureReason ? (
            <Text variant="caption" color="muted">
              {delivery.failureReason}
            </Text>
          ) : null}
        </Card>
      ) : null}

      {/* Actions : une seule action principale à la fois. */}
      {!isClosed ? (
        <View style={styles.actions}>
          {action ? (
            <Button
              label={action.label}
              onPress={() => statusMutation.mutate({ status: action.status })}
              loading={statusMutation.isPending}
            />
          ) : null}

          {delivery.status !== 'ASSIGNED' && !isDeclaringFailure ? (
            <Button
              label="Livraison impossible"
              variant="outline"
              onPress={() => setDeclaringFailure(true)}
            />
          ) : null}

          {isDeclaringFailure ? (
            <Card style={styles.card}>
              <Text variant="h3">Livraison impossible</Text>
              <Input
                label="Raison"
                placeholder="Ex. client absent après deux appels"
                value={failureReason}
                onChangeText={setFailureReason}
                autoFocus
              />
              <View style={styles.failureActions}>
                <Button
                  label="Retour"
                  variant="outline"
                  size="sm"
                  onPress={() => {
                    setDeclaringFailure(false);
                    setFailureReason('');
                  }}
                />
                <Button
                  label="Confirmer l’échec"
                  size="sm"
                  onPress={confirmFailure}
                  loading={statusMutation.isPending}
                  disabled={failureReason.trim().length === 0}
                />
              </View>
            </Card>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.bg },
  content: { paddingHorizontal: spacing.md, gap: spacing.sm },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  card: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  addressActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  flex: { flex: 1 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  total: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: palette.line,
  },
  methodRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginVertical: spacing.xs,
  },
  method: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    backgroundColor: palette.card,
  },
  methodSelected: {
    borderColor: palette.green,
    backgroundColor: palette.greenSoft,
  },
  block: { gap: spacing.sm, marginTop: spacing.xs },
  proofDone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: palette.greenSoft,
  },
  actions: { gap: spacing.sm, marginTop: spacing.sm },
  failureActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  trackingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
