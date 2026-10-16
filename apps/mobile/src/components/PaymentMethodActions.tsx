import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  buildUssdCode,
  paymentLinkToOpen,
  ussdDialUrl,
  type DirectPaymentMethod,
} from '@agrim/contracts';

import { Button, Icon, Text } from '@/components/ui';
import { canDialUssd, openPublishedLink } from '@/lib/paymentActions';
import { palette, spacing } from '@/theme/tokens';

/**
 * Les gestes qui marchent AVEC UN SEUL TÉLÉPHONE : ouvrir le lien de paiement
 * de l'opérateur, ou composer son code USSD.
 *
 * Ce composant n'invente rien et ne montre rien qui ne soit publié :
 *  - sans lien publié → aucun bouton ;
 *  - sans code publié → aucun code ;
 *  - un code qui réclame le montant n'est montré que là où le montant est
 *    connu (l'écran de paiement d'une commande). Sur l'écran « Payer AGRIM »,
 *    où il n'y a pas de commande, on ne fait pas deviner un montant.
 */
export type PaymentMethodActionsProps = {
  method: DirectPaymentMethod;
  /** Montant exact de la commande, ou `null` hors commande. */
  amount: number | null;
};

export function PaymentMethodActions({
  method,
  amount,
}: PaymentMethodActionsProps) {
  const [open, setOpen] = useState<'lien' | 'code' | null>(null);
  const [echec, setEchec] = useState(false);

  const lien = paymentLinkToOpen(method);
  const besoinMontant = (method.ussdTemplate ?? '').includes('{amount}');
  const code =
    amount !== null || !besoinMontant
      ? buildUssdCode(method.ussdTemplate, {
          number: method.receivingNumber,
          amount: amount ?? 0,
        })
      : null;

  if (!lien && !code) return null;

  const ouvrir = async () => {
    if (!lien) return;
    setEchec(false);
    const ouvert = await openPublishedLink(lien);
    if (!ouvert) {
      setEchec(true);
      return;
    }
    setOpen('lien');
  };

  const copierCode = async () => {
    if (!code) return;
    await Clipboard.setStringAsync(code);
    setOpen('code');
  };

  return (
    <View style={styles.bloc}>
      {lien ? (
        <>
          <Button
            label={`PAYER AVEC ${method.operatorName.toUpperCase()}`}
            onPress={() => void ouvrir()}
            icon={<Icon name="external-link" size={17} color="white" />}
          />
          <Text variant="caption" color="muted">
            Ouvre l’application {method.operatorName} avec le compte marchand
            d’AGRIM. Le montant exact et la référence restent à saisir.
          </Text>
        </>
      ) : null}

      {echec ? (
        <Text variant="caption" color="danger">
          Impossible d’ouvrir {method.operatorName} depuis l’application.
          Copiez le numéro ci-dessus, ou composez vous-même le code.
        </Text>
      ) : null}

      {code ? (
        <View style={styles.code}>
          <Text variant="micro" color="muted">
            CODE À COMPOSER
          </Text>
          <Text variant="bodyStrong" selectable>
            {code}
          </Text>
          <View style={styles.actions}>
            <Button
              label={open === 'code' ? 'CODE COPIÉ' : 'COPIER LE CODE'}
              variant="outline"
              size="sm"
              fullWidth={false}
              onPress={() => void copierCode()}
              icon={<Icon name="copy" size={15} color="green" />}
            />
            {canDialUssd() ? (
              <Button
                label="COMPOSER"
                variant="outline"
                size="sm"
                fullWidth={false}
                onPress={() => void openPublishedLink(ussdDialUrl(code))}
                icon={<Icon name="phone" size={15} color="green" />}
              />
            ) : null}
          </View>
          {canDialUssd() ? (
            <Text variant="caption" color="muted">
              Le téléphone demande l’ouverture du composeur. Selon l’appareil,
              le code est déjà écrit ou reste à recopier — « COPIER LE CODE »
              sert exactement à ça.
            </Text>
          ) : (
            // iOS bloque les codes USSD : le dire vaut mieux que de promettre
            // un bouton qui ne s'ouvrira jamais.
            <Text variant="caption" color="muted">
              Sur iPhone, composez ce code vous-même : iOS n’autorise pas son
              ouverture depuis une application.
            </Text>
          )}
        </View>
      ) : null}

      {open === 'lien' ? (
        <Text variant="caption" color="green">
          Application {method.operatorName} ouverte. Revenez ici pour déclarer
          votre transfert.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bloc: { gap: spacing.sm },
  code: {
    backgroundColor: palette.bg,
    borderColor: palette.line,
    borderRadius: 11,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
