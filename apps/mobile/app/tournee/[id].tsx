import {
  useDelivery,
  useSubmitProof,
  useUpdateDeliveryStatus,
  uploadProofFile,
  type Delivery,
} from '@/api/deliveries';
import {
  SignaturePad,
  type SignaturePadHandle,
} from '@/components/SignaturePad';
import { MapView, boundsOf, type MapMarker } from '@/components/map';
import { ErrorState, Skeleton } from '@/components/states';
import { Button, Card, Icon, Input, Pill, Text } from '@/components/ui';
import { formatXof } from '@/lib/format';
import { useCourierTracking } from '@/lib/useCourierTracking';
import { palette, radius, spacing } from '@/theme/tokens';
import {
  DELIVERY_PROOF_DEFAULT_METHOD,
  type DeliveryProofMethod,
  type DeliveryStatus,
} from '@agrim/contracts';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
 * laisse le serveur trancher. La preuve est obligatoire avant validation —
 * l'interface le reflète en désactivant le bouton, mais c'est le backend qui
 * l'impose réellement.
 */

/** Action proposée pour l'état courant. `null` : rien à faire. */
const NEXT_ACTION: Partial<
  Record<Delivery['status'], { label: string; status: DeliveryStatus }>
> = {
  ASSIGNED: { label: 'Accepter la course', status: 'ACCEPTED' },
  ACCEPTED: { label: 'J’ai récupéré le colis', status: 'PICKED_UP' },
  PICKED_UP: { label: 'Démarrer la livraison', status: 'IN_TRANSIT' },
};

const SIGNATURE_HEIGHT = 200;

export default function CourseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const query = useDelivery(id ?? '');
  const statusMutation = useUpdateDeliveryStatus(id ?? '');
  const proofMutation = useSubmitProof(id ?? '');

  const [methods, setMethods] = useState<DeliveryProofMethod[]>([
    DELIVERY_PROOF_DEFAULT_METHOD,
  ]);
  const [signaturePaths, setSignaturePaths] = useState<string[] | null>(null);
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [receivedBy, setReceivedBy] = useState('');
  const [note, setNote] = useState('');
  const [isUploading, setUploading] = useState(false);
  const signatureRef = useRef<SignaturePadHandle>(null);
  const tracking = useCourierTracking(id ?? '');
  const [isDeclaringFailure, setDeclaringFailure] = useState(false);
  const [failureReason, setFailureReason] = useState('');

  const delivery = query.data;

  /**
   * Le GPS ne tourne que pendant le trajet : il démarre à la prise en charge
   * et s'arrête dès que la course est close. La permission n'est donc jamais
   * demandée à l'ouverture de l'écran.
   */
  const isRolling =
    delivery?.status === 'PICKED_UP' || delivery?.status === 'IN_TRANSIT';

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

  const toggleMethod = useCallback((method: DeliveryProofMethod) => {
    setMethods((current) =>
      current.includes(method)
        ? current.filter((m) => m !== method)
        : [...current, method],
    );
  }, []);

  const pickPhoto = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Appareil photo indisponible',
        'Autorisez l’accès à l’appareil photo pour joindre une photo de preuve.',
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.6,
      allowsEditing: false,
      mediaTypes: ['images'],
    });
    if (!result.canceled) setPhoto(result.assets[0] ?? null);
  }, []);

  /** Contrôle local, miroir de la règle serveur (qui reste l'autorité). */
  const proofIssue = useMemo(() => {
    if (methods.length === 0) return 'Choisissez au moins une preuve.';
    if (methods.includes('SIGNATURE') && !signaturePaths)
      return 'La signature est vide.';
    if (methods.includes('SIGNATURE') && receivedBy.trim().length === 0)
      return 'Indiquez le nom du réceptionnaire.';
    if (methods.includes('PHOTO') && !photo) return 'Prenez une photo.';
    return null;
  }, [methods, signaturePaths, receivedBy, photo]);

  const submitProof = useCallback(async () => {
    if (proofIssue || !delivery) return;
    setUploading(true);
    try {
      let signatureFileId: string | undefined;
      let photoFileId: string | undefined;

      if (methods.includes('SIGNATURE') && signaturePaths) {
        // Export PNG par le moteur natif : le serveur n'accepte que de vraies
        // images et contrôle leur signature binaire.
        const base64 = await signatureRef.current?.exportPng();
        if (!base64) throw new Error('La signature n’a pas pu être capturée.');
        const uploaded = await uploadProofFile({
          uri: `data:image/png;base64,${base64}`,
          name: 'signature.png',
          type: 'image/png',
        });
        signatureFileId = uploaded.id;
      }

      if (methods.includes('PHOTO') && photo) {
        const uploaded = await uploadProofFile({
          uri: photo.uri,
          name: photo.fileName ?? 'preuve.jpg',
          type: photo.mimeType ?? 'image/jpeg',
        });
        photoFileId = uploaded.id;
      }

      await proofMutation.mutateAsync({
        methods,
        signatureFileId,
        photoFileId,
        receivedBy: receivedBy.trim() || undefined,
        note: note.trim() || undefined,
      });
    } catch (error) {
      Alert.alert(
        'Preuve non enregistrée',
        error instanceof Error ? error.message : 'Réessayez dans un instant.',
      );
    } finally {
      setUploading(false);
    }
  }, [
    proofIssue,
    delivery,
    methods,
    signaturePaths,
    photo,
    receivedBy,
    note,
    proofMutation,
  ]);

  const confirmDelivered = useCallback(() => {
    Alert.alert('Valider la livraison', 'Confirmez-vous la remise du colis ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Valider',
        onPress: () => {
          statusMutation.mutate(
            { status: 'DELIVERED' },
            { onSuccess: () => router.back() },
          );
        },
      },
    ]);
  }, [statusMutation, router]);

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
  const canProve =
    delivery.status === 'PICKED_UP' || delivery.status === 'IN_TRANSIT';
  const hasProof = delivery.proofSubmittedAt !== null;
  const isClosed =
    delivery.status === 'DELIVERED' || delivery.status === 'FAILED';

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

        {delivery.address.contactPhone ? (
          <Button
            label="Appeler le client"
            variant="outline"
            size="sm"
            onPress={() =>
              void Linking.openURL(`tel:${delivery.address.contactPhone}`)
            }
          />
        ) : null}
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

      {/* Preuve : disponible une fois le colis récupéré, obligatoire avant
          la validation. */}
      {canProve && !hasProof ? (
        <Card style={styles.card}>
          <Text variant="h3">Preuve de livraison</Text>
          <Text variant="caption" color="muted">
            La signature est la méthode par défaut. Ajoutez une photo si le
            client est absent ou refuse de signer.
          </Text>

          <View style={styles.methodRow}>
            {(['SIGNATURE', 'PHOTO'] as const).map((method) => {
              const selected = methods.includes(method);
              return (
                <Pressable
                  key={method}
                  onPress={() => toggleMethod(method)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  style={[styles.method, selected && styles.methodSelected]}
                >
                  <Icon
                    name={method === 'SIGNATURE' ? 'pen-line' : 'camera'}
                    size={16}
                    color={selected ? 'green' : 'muted'}
                  />
                  <Text variant="caption" color={selected ? 'green' : 'muted'}>
                    {method === 'SIGNATURE' ? 'Signature' : 'Photo'}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {methods.includes('SIGNATURE') ? (
            <View style={styles.block}>
              <SignaturePad
                ref={signatureRef}
                height={SIGNATURE_HEIGHT}
                onChange={setSignaturePaths}
              />
              <Input
                label="Nom du réceptionnaire"
                placeholder="Ex. Awa Koné"
                value={receivedBy}
                onChangeText={setReceivedBy}
              />
            </View>
          ) : null}

          {methods.includes('PHOTO') ? (
            <View style={styles.block}>
              <Button
                label={photo ? 'Reprendre la photo' : 'Prendre une photo'}
                variant="outline"
                size="sm"
                onPress={() => void pickPhoto()}
              />
              {photo ? (
                <View style={styles.row}>
                  <Icon name="check" size={15} color="green" />
                  <Text variant="caption" color="muted">
                    Photo prête à être envoyée
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          <Input
            label="Remarque (facultatif)"
            placeholder="Ex. remis au gardien"
            value={note}
            onChangeText={setNote}
          />

          {proofIssue ? (
            <Text variant="caption" color="danger">
              {proofIssue}
            </Text>
          ) : null}

          <Button
            label="Enregistrer la preuve"
            onPress={() => void submitProof()}
            loading={isUploading || proofMutation.isPending}
            disabled={proofIssue !== null}
          />
        </Card>
      ) : null}

      {hasProof && !isClosed ? (
        <Card style={styles.proofDone}>
          <Icon name="shield-check" size={18} color="green" />
          <Text variant="body" color="body" style={styles.flex}>
            Preuve enregistrée
            {delivery.proofReceivedBy ? ` · ${delivery.proofReceivedBy}` : ''}
          </Text>
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

          {delivery.status === 'IN_TRANSIT' ? (
            <Button
              label="Valider la livraison"
              onPress={confirmDelivered}
              loading={statusMutation.isPending}
              disabled={!hasProof}
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
