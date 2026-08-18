import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ORDER_STATUS_NOTIFICATION,
  renderNotification,
  type NotificationType,
  type OrderStatus,
} from '@agrim/contracts';

import { PrismaService } from '../prisma/prisma.service';
import { PUSH_PROVIDER, type PushProvider } from './push.provider';

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
  ) {
    try {
      const tokens = await this.prisma.db.pushToken.findMany({
        where: { userId },
        select: { token: true },
      });
      if (tokens.length === 0) return;

      const result = await this.push.send({
        tokens: tokens.map((t) => t.token),
        title,
        body,
        data: reference ? { reference } : undefined,
      });

      // Jetons morts (application désinstallée) : les garder ferait grossir
      // la table et ralentirait chaque envoi.
      if (result.invalidTokens.length > 0) {
        await this.prisma.db.pushToken.deleteMany({
          where: { token: { in: result.invalidTokens } },
        });
      }
    } catch {
      this.logger.warn('Notification non distribuée.');
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
