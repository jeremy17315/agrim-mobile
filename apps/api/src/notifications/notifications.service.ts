import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ORDER_STATUS_NOTIFICATION,
  renderNotification,
  type NotificationType,
  type OrderStatus,
} from '@agrim/contracts';

import { PrismaService } from '../prisma/prisma.service';
import { PUSH_PROVIDER, type PushProvider } from './push.provider';
import { SMS_PROVIDER, type SmsProvider } from './sms.provider';

/**
 * Événements qui justifient de payer un SMS quand le push n'a pas abouti.
 *
 * Liste fermée et courte : elle ne retient que ce qui appelle une action ou
 * une attente du client. Le même arbitrage a été fait côté site, où le SMS
 * ne double le WhatsApp que sur trois étapes.
 *
 * DELIVERY_OTP en est absent à dessein : le code de livraison ne transite
 * jamais par un canal tiers.
 */
const SMS_WORTHY = new Set<NotificationType>([
  'ORDER_CONFIRMED',
  'ORDER_OUT_FOR_DELIVERY',
  'ORDER_DELIVERED',
  'ORDER_CANCELLED',
  'PAYMENT_FAILED',
]);

/**
 * Notifications.
 *
 * Principe directeur : une notification ne doit JAMAIS faire échouer l'action
 * métier qui la déclenche. Une commande passée reste passée même si le service
 * de push est injoignable — l'enregistrement en base fait foi, l'envoi est
 * opportuniste.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  /**
   * Enregistre une notification et tente de la pousser.
   * Les erreurs sont absorbées : l'appelant n'a pas à s'en préoccuper.
   */
  async notify(input: {
    userId: string;
    type: NotificationType;
    reference?: string;
    orderId?: string;
    /** Valeurs injectées dans le gabarit (ex. le code de livraison). */
    values?: { code?: string };
  }) {
    const { title, body } = renderNotification(input.type, {
      reference: input.reference,
      code: input.values?.code,
    });

    const notification = await this.prisma.db.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title,
        body,
        orderId: input.orderId ?? null,
      },
      select: { id: true, type: true, title: true, body: true },
    });

    // Le code de livraison ne part JAMAIS en notification poussée : celle-ci
    // transite par un service tiers et s'affiche sur un écran verrouillé, à la
    // vue de n'importe qui. Le client ouvre l'application pour le lire.
    const isSensitive = input.type === 'DELIVERY_OTP';

    // L'envoi est volontairement détaché du résultat retourné.
    void this.deliver(
      input.userId,
      title,
      isSensitive
        ? 'Ouvrez l’application pour voir votre code de livraison.'
        : body,
      input.reference,
      input.type,
      notification.id,
    );

    return notification;
  }

  /**
   * Notifie un changement de statut de commande.
   * Les statuts sans gabarit (PENDING) sont ignorés silencieusement.
   */
  async notifyOrderStatus(input: {
    userId: string;
    status: OrderStatus;
    reference: string;
    orderId: string;
  }) {
    const type = ORDER_STATUS_NOTIFICATION[input.status];
    if (!type) return null;

    return this.notify({
      userId: input.userId,
      type,
      reference: input.reference,
      orderId: input.orderId,
    });
  }

  /** Envoi effectif, isolé pour ne jamais propager d'erreur. */
  private async deliver(
    userId: string,
    title: string,
    body: string,
    reference?: string,
    type?: NotificationType,
    notificationId?: string,
  ) {
    let pushed = 0;
    try {
      const tokens = await this.prisma.db.pushToken.findMany({
        where: { userId },
        select: { token: true },
      });

      if (tokens.length > 0) {
        const result = await this.push.send({
          tokens: tokens.map((t) => t.token),
          title,
          body,
          data: reference ? { reference } : undefined,
        });
        pushed = result.sent;

        // Jetons morts (application désinstallée) : les garder ferait grossir
        // la table et ralentirait chaque envoi.
        if (result.invalidTokens.length > 0) {
          await this.prisma.db.pushToken.deleteMany({
            where: { token: { in: result.invalidTokens } },
          });
        }
      }
    } catch {
      this.logger.warn('Notification non distribuée.');
    }

    // Repli SMS. Avant, un client sans jeton — application désinstallée,
    // notifications refusées, téléphone changé — n'était prévenu de RIEN :
    // `deliver` s'arrêtait là, en silence. C'est précisément le client qu'il
    // faut joindre autrement.
    if (pushed === 0 && type && this.meriteUnSms(type)) {
      await this.envoyerSms(userId, body, type, reference, notificationId);
    }
  }

  /**
   * Cet événement justifie-t-il de payer un SMS ?
   *
   * Liste FERMÉE, et volontairement courte : elle ne retient que ce qui
   * appelle une action ou une attente du client. Prévenir par SMS qu'une
   * commande passe « en préparation » coûterait sans rien apporter.
   *
   * DELIVERY_OTP en est exclu : le code de livraison ne transite jamais par
   * un canal tiers — même règle que pour le push (voir `notify`).
   */
  private meriteUnSms(type: NotificationType): boolean {
    return SMS_WORTHY.has(type);
  }

  /** Demande au site d'envoyer le SMS. N'échoue jamais bruyamment. */
  private async envoyerSms(
    userId: string,
    body: string,
    type: NotificationType,
    reference?: string,
    notificationId?: string,
  ): Promise<void> {
    try {
      const user = await this.prisma.db.user.findUnique({
        where: { id: userId },
        select: { phone: true },
      });
      if (!user?.phone) return;

      // La clé d'idempotence porte l'identifiant de la notification : deux
      // tentatives pour la même notification ne paient qu'un SMS.
      const uniqueKey = notificationId
        ? `app:notification:${notificationId}`
        : `app:${type}:${reference ?? userId}`;

      const result = await this.sms.send({
        to: user.phone,
        body: reference ? `${body} (${reference})` : body,
        event: type,
        uniqueKey,
      });

      if (result.sent) {
        this.logger.log(`Repli SMS envoyé (${type}) — aucun jeton push actif.`);
      }
    } catch {
      // Un SMS manqué ne doit pas plus faire échouer la commande qu'un push.
      this.logger.warn('Repli SMS non distribué.');
    }
  }

  /* ------------------------------ Consultation --------------------------- */

  async list(userId: string, page = 1, limit = 20) {
    const [items, total, unread] = await Promise.all([
      this.prisma.db.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          isRead: true,
          orderId: true,
          createdAt: true,
        },
      }),
      this.prisma.db.notification.count({ where: { userId } }),
      this.prisma.db.notification.count({ where: { userId, isRead: false } }),
    ]);

    return {
      data: items,
      meta: { page, limit, total, unread },
    };
  }

  /**
   * Marque comme lues. Le filtre sur `userId` est essentiel : sans lui, un
   * identifiant deviné permettrait de manipuler les notifications d'autrui.
   */
  async markRead(userId: string, ids?: string[]) {
    const result = await this.prisma.db.notification.updateMany({
      where: {
        userId,
        isRead: false,
        ...(ids && ids.length > 0 ? { id: { in: ids } } : {}),
      },
      data: { isRead: true },
    });
    return { updated: result.count };
  }

  /* ------------------------------ Jetons push ---------------------------- */

  /**
   * Enregistre le jeton d'un appareil.
   *
   * Un jeton peut migrer d'un compte à l'autre sur un téléphone partagé :
   * l'`upsert` le réattribue au dernier utilisateur connecté plutôt que de
   * laisser deux comptes recevoir les mêmes notifications.
   */
  async registerToken(userId: string, token: string, platform: string) {
    await this.prisma.db.pushToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform },
    });
    return { registered: true };
  }

  /** Retire le jeton, typiquement à la déconnexion. */
  async removeToken(userId: string, token: string) {
    await this.prisma.db.pushToken.deleteMany({ where: { userId, token } });
    return { removed: true };
  }
}
