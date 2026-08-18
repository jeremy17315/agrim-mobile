import { Injectable, Logger } from '@nestjs/common';

/**
 * Contrat d'envoi de notifications poussées.
 *
 * Aucun fournisseur n'apparaît dans le service métier : celui-ci enregistre
 * une notification et demande son envoi. Passer d'Expo à FCM, ou ajouter un
 * canal SMS, se fera en écrivant un pilote derrière cette interface.
 */

export type PushMessage = {
  /** Jetons destinataires. */
  tokens: string[];
  title: string;
  body: string;
  /** Charge utile de navigation (référence de commande, écran cible). */
  data?: Record<string, string>;
};

export type PushResult = {
  sent: number;
  /** Jetons refusés par le fournisseur : à supprimer de la base. */
  invalidTokens: string[];
};

export abstract class PushProvider {
  abstract send(message: PushMessage): Promise<PushResult>;
}

export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');

/**
 * Pilote Expo Push.
 *
 * Choisi pour la V1 : il fonctionne sans compte Firebase ni certificat APNs
 * côté serveur, ce qui évite d'immobiliser le développement en attendant des
 * accès. L'envoi réel exige un dev build côté mobile — le push distant n'est
 * plus disponible dans Expo Go sur Android depuis le SDK 53.
 *
 * Sans jeton valide, aucun appel réseau n'est tenté : l'application reste
 * fonctionnelle, seules les notifications en base subsistent.
 */
@Injectable()
export class ExpoPushProvider extends PushProvider {
  private readonly logger = new Logger(ExpoPushProvider.name);
  private readonly endpoint = 'https://exp.host/--/api/v2/push/send';

  async send(message: PushMessage): Promise<PushResult> {
    const tokens = message.tokens.filter((t) =>
      t.startsWith('ExponentPushToken'),
    );
    if (tokens.length === 0) return { sent: 0, invalidTokens: [] };

    // Expo accepte 100 messages par requête.
    const batches: string[][] = [];
    for (let i = 0; i < tokens.length; i += 100) {
      batches.push(tokens.slice(i, i + 100));
    }

    let sent = 0;
    const invalidTokens: string[] = [];

    for (const batch of batches) {
      try {
        const response = await fetch(this.endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            batch.map((to) => ({
              to,
              title: message.title,
              body: message.body,
              data: message.data,
              sound: 'default',
              priority: 'high',
            })),
          ),
        });

        if (!response.ok) {
          // Un envoi raté ne doit jamais faire échouer l'action métier qui
          // l'a déclenché : la commande est passée, la notification non.
          this.logger.warn(`Envoi push refusé (${response.status})`);
          continue;
        }

        const payload = (await response.json()) as {
          data?: { status: string; details?: { error?: string } }[];
        };

        payload.data?.forEach((ticket, index) => {
          if (ticket.status === 'ok') {
            sent += 1;
          } else if (ticket.details?.error === 'DeviceNotRegistered') {
            // Application désinstallée : le jeton est mort, on le purge.
            invalidTokens.push(batch[index]!);
          }
        });
      } catch {
        this.logger.warn('Service de notifications injoignable.');
      }
    }

    return { sent, invalidTokens };
  }
}

/**
 * Pilote inerte, pour les tests et les environnements sans réseau sortant.
 * Il journalise sans rien envoyer.
 */
@Injectable()
export class NoopPushProvider extends PushProvider {
  send(message: PushMessage): Promise<PushResult> {
    return Promise.resolve({ sent: message.tokens.length, invalidTokens: [] });
  }
}
