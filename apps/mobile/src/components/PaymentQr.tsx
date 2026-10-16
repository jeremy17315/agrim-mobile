import { StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Icon, Text } from '@/components/ui';
import { palette, radius, spacing } from '@/theme/tokens';

/**
 * QR MARCHAND d'un compte de paiement.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Ce composant ne FABRIQUE rien : il réaffiche, tel quel, le contenu publié
 * par AGRIM dans la configuration du moyen de paiement — le même texte que le
 * QR remis par MTN, Orange Money ou Wave. Un contenu inventé enverrait
 * l'argent du client à un inconnu : c'est la règle qui a déjà cours pour les
 * numéros de réception, elle vaut aussi pour le QR.
 *
 * Sans contenu publié, RIEN n'est affiché (l'appelant décide du message) :
 * un carré vide ou un faux QR serait pire qu'une absence.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export type PaymentQrProps = {
  /** Contenu exact publié par AGRIM. `null` (ou vide) = pas de QR. */
  payload: string | null;
  /** Nom de l'opérateur, annoncé aux lecteurs d'écran. */
  operatorName: string;
  /** Côté du carré, en points. 176 par défaut : lisible, tient sur un écran. */
  size?: number;
};

export function PaymentQr({
  payload,
  operatorName,
  size = 176,
}: PaymentQrProps) {
  const contenu = payload?.trim();
  if (!contenu) return null;

  return (
    <View
      style={styles.block}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`QR du compte marchand ${operatorName}`}
    >
      <View style={styles.frame}>
        <QRCode
          value={contenu}
          size={size}
          backgroundColor={palette.white}
          color={palette.ink}
          // Correction moyenne : tolère un écran un peu sale sans grossir le QR
          // au point de ne plus tenir dans la carte.
          ecl="M"
        />
      </View>
      <View style={styles.note}>
        <Icon name="scan-line" size={14} color="muted" />
        <Text variant="caption" color="muted" style={styles.flex}>
          Scannez avec l’application {operatorName} : le compte marchand d’AGRIM
          se remplit tout seul. Le montant exact et la référence restent à
          saisir.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  frame: {
    backgroundColor: palette.white,
    borderColor: palette.line,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
  },
  note: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  flex: { flex: 1 },
});
