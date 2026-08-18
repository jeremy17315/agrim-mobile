import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCloseDelivery } from '@/api/management';
import { Banner, Button, Icon, Input, Text } from '@/components/ui';
import { describeError } from '@/api/errors';
import { palette, radius, spacing } from '@/theme/tokens';

/** Longueur minimale du motif, alignée sur la règle serveur. */
const MIN_REASON = 10;

/**
 * Clôture d'exception d'une livraison, côté gestion.
 *
 * Voie de secours pour les cas où le client ne peut pas donner son code :
 * téléphone déchargé, colis remis au gardien, client injoignable sur place.
 *
 * Deux garde-fous assumés dans cet écran. Le premier : l'action n'est pas
 * offerte au livreur, sinon la validation par code deviendrait décorative —
 * celui qui livre ne peut pas être celui qui atteste de la livraison. Le
 * second : le motif est obligatoire et libre, parce qu'une liste de choix
 * finirait par être cliquée mécaniquement, alors qu'une phrase à écrire
 * engage son auteur. Ce texte est conservé avec son nom.
 */
export function ManualClosureSheet({
  reference,
  visible,
  onClose,
  onDone,
}: {
  reference: string;
  visible: boolean;
  onClose: () => void;
  onDone?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const close = useCloseDelivery();

  const tooShort = reason.trim().length < MIN_REASON;
  const error =
    touched && tooShort ? 'Décrivez la situation en une phrase.' : undefined;

  const dismiss = () => {
    setReason('');
    setTouched(false);
    setFailure(null);
    onClose();
  };

  const submit = () => {
    setTouched(true);
    if (tooShort) return;

    setFailure(null);
    close.mutate(
      { reference, reason: reason.trim() },
      {
        onSuccess: () => {
          dismiss();
          onDone?.();
        },
        onError: (err) => setFailure(describeError(err)),
      },
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={dismiss}
    >
      <View style={styles.backdrop}>
        {/* Fermeture par appui hors de la feuille : geste attendu ici. */}
        <Pressable
          style={styles.dismissArea}
          onPress={dismiss}
          accessibilityRole="button"
          accessibilityLabel="Fermer"
        />

        <View
          style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}
        >
          <View style={styles.handle} />

          <View style={styles.header}>
            <Icon name="shield-alert" size={19} color="warn" />
            <Text variant="h2" style={styles.flex}>
              Clôturer sans code
            </Text>
          </View>

          <Text variant="caption" color="body">
            À n’utiliser que si le client ne peut pas donner son code sur place.
            La commande {reference} passera en livrée, et cette clôture sera
            signalée à la direction avec votre nom.
          </Text>

          <Input
            label="Motif"
            required
            value={reason}
            onChangeText={setReason}
            onBlur={() => setTouched(true)}
            error={error}
            hint="Exemple : téléphone du client déchargé, colis remis en main propre."
            placeholder="Décrivez ce qui s’est passé"
            multiline
            numberOfLines={3}
            maxLength={500}
            style={styles.reason}
            textAlignVertical="top"
          />

          {failure ? <Banner tone="danger" message={failure} /> : null}

          <View style={styles.actions}>
            <Button
              label="Confirmer la clôture"
              onPress={submit}
              loading={close.isPending}
              fullWidth
            />
            <Button
              label="Revenir"
              variant="ghost"
              onPress={dismiss}
              disabled={close.isPending}
              fullWidth
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(26, 46, 20, 0.45)' },
  dismissArea: { flex: 1 },
  sheet: {
    backgroundColor: palette.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: palette.line,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  reason: { minHeight: 88 },
  actions: { gap: spacing.xs },
  flex: { flex: 1 },
});
