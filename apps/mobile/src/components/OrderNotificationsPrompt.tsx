import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { askForOrderNotifications } from '@/lib/usePushRegistration';
import { spacing } from '@/theme/tokens';

import { Button, Card, Text } from './ui';

const SEEN_KEY = 'agrim.push.orderPromptSeen';

/**
 * Demande de permission, faite APRÈS la première commande, avec son motif.
 * Affichée une seule fois : un refus n'est jamais redemandé en boucle.
 */
export function OrderNotificationsPrompt() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!Device.isDevice) return;
      const seen = await AsyncStorage.getItem(SEEN_KEY);
      const { status } = await Notifications.getPermissionsAsync();
      if (active && !seen && status === 'undetermined') setVisible(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!visible) return null;

  const close = async () => {
    await AsyncStorage.setItem(SEEN_KEY, '1');
    setVisible(false);
  };

  return (
    <Card style={styles.card}>
      <Text variant="bodyStrong">Être prévenu(e) quand votre commande avance</Text>
      <Text variant="caption" color="muted">
        Nous vous écrivons seulement pour le suivi de vos commandes. Les
        promotions restent facultatives.
      </Text>
      <View style={styles.actions}>
        <Button
          label="Activer les notifications"
          onPress={async () => {
            await askForOrderNotifications();
            await close();
          }}
        />
        <Button label="Pas maintenant" variant="ghost" onPress={close} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, marginBottom: spacing.md },
  actions: { gap: spacing.xs },
});
