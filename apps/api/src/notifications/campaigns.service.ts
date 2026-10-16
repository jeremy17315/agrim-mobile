import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  deepLinkToData,
  NOTIFICATION_TARGETS,
  NOTIFICATION_TARGET_VALUE_HINTS,
  type CampaignAudience,
  type NotificationCategory,
  type NotificationTarget,
} from '@agrim/contracts';
import type { Role } from '@agrim/contracts';
import type { Prisma } from '../../generated/prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

/**
 * Campagnes de notifications, rédigées puis envoyées depuis l'administration.
 *
 * Trois règles, toutes visibles dans le code ci-dessous :
 *
 *  1. **Rien ne part tout seul.** Une campagne naît BROUILLON ; l'envoi est un
 *     geste distinct, et un second envoi est refusé (une campagne ne double
 *     jamais deux fois la même promotion).
 *  2. **Le consentement promotionnel compte.** Une campagne ne vise que les
 *     appareils `promoOptIn` ; les messages de service (commande, paiement) ne
 *     consultent jamais cette préférence — ils ne passent pas par ici.
 *  3. **Les compteurs disent la vérité.** `sentCount` = accepté par le service,
 *     `failedCount` = refusé, `invalidCount` = appareil disparu. Aucun ne dit
 *     « lu » : l'écran d'administration l'écrit noir sur blanc.
 */

/** Champs renvoyés au back-office : jamais les identifiants des destinataires. */
const campaignSelect = {
  id: true,
  title: true,
  body: true,
  category: true,
  linkTarget: true,
  linkValue: true,
  audience: true,
  status: true,
  targetCount: true,
  sentCount: true,
  failedCount: true,
  invalidCount: true,
  lastError: true,
  sentAt: true,
  createdAt: true,
} as const;

/** Rôles internes : seuls leurs appareils servent aux envois de test. */
const ROLES_INTERNES: Role[] = ['GESTIONNAIRE', 'ADMIN', 'DG'];

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Dernières campagnes, la plus récente d'abord. */
  list() {
    return this.prisma.db.notificationCampaign.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: campaignSelect,
    });
  }

  /**
   * Rédige un brouillon.
   *
   * Le nombre de destinataires est calculé MAINTENANT pour que le rédacteur
   * sache à combien de personnes il parle avant d'appuyer sur « envoyer ».
   */
  async create(input: {
    title: string;
    body: string;
    category: NotificationCategory;
    linkTarget: NotificationTarget;
    linkValue?: string;
    audience: CampaignAudience;
    createdById: string;
  }) {
    const titre = input.title.trim().replace(/\s+/g, ' ');
    const message = input.body.trim();
    const valeur = (input.linkValue ?? '').trim();

    // Une destination qui a besoin d'une valeur sans en avoir ne mène nulle
    // part : on refuse à la rédaction plutôt que d'envoyer un lien mort.
    const besoin = NOTIFICATION_TARGET_VALUE_HINTS[input.linkTarget];
    if (besoin !== 'aucune valeur' && valeur.length === 0) {
      throw new BadRequestException({
        code: 'CAMPAIGN_LINK_VALUE_REQUIRED',
        message: `Cette destination a besoin d’une valeur (${besoin}).`,
      });
    }

    const targetCount = await this.countAudience(input.audience);

    return this.prisma.db.notificationCampaign.create({
      data: {
        title: titre,
        body: message,
        category: input.category,
        linkTarget: input.linkTarget,
        linkValue: besoin === 'aucune valeur' ? null : valeur,
        audience: input.audience,
        status: 'DRAFT',
        targetCount,
        createdById: input.createdById,
      },
      select: campaignSelect,
    });
  }

  /**
   * Envoie une campagne.
   *
   * Refusé si elle est déjà partie : un double appui sur « envoyer », un
   * retour arrière ou deux responsables simultanés ne doivent jamais envoyer
   * deux fois la même promotion. La transition de statut est donc un
   * `updateMany` conditionnel — le second appel ne trouve plus rien à clamer.
   *
   * Une exception, volontaire : une campagne dont RIEN n'est parti
   * (`sentCount = 0`, service de notifications en panne, push désactivé) peut
   * être relancée. Dès qu'un seul appareil a été servi, en revanche, un nouvel
   * envoi doublerait la promotion chez lui : c'est un refus, pas une reprise.
   */
  async send(id: string) {
    const campagne = await this.prisma.db.notificationCampaign.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        body: true,
        category: true,
        linkTarget: true,
        linkValue: true,
        audience: true,
        status: true,
        sentCount: true,
      },
    });
    if (!campagne) {
      throw new NotFoundException({
        code: 'CAMPAIGN_NOT_FOUND',
        message: 'Cette campagne n’existe pas.',
      });
    }
    if (campagne.status === 'SENT' || campagne.status === 'SENDING') {
      throw new ConflictException({
        code: 'CAMPAIGN_ALREADY_SENT',
        message: 'Cette campagne a déjà été envoyée.',
      });
    }

    // Échec PARTIEL : des appareils ont déjà reçu le message. Reprendre
    // l'envoi le leur ferait recevoir deux fois — on refuse et on explique.
    if (campagne.status === 'FAILED' && campagne.sentCount > 0) {
      throw new ConflictException({
        code: 'CAMPAIGN_PARTIALLY_SENT',
        message: `Cette campagne a déjà atteint ${campagne.sentCount} appareil(s) : la relancer la doublerait chez eux. Rédigez-en une nouvelle pour les autres.`,
      });
    }

    const claim = await this.prisma.db.notificationCampaign.updateMany({
      where: { id, status: { in: ['DRAFT', 'SCHEDULED', 'FAILED'] } },
      data: { status: 'SENDING', sendingAt: new Date() },
    });
    if (claim.count === 0) {
      throw new ConflictException({
        code: 'CAMPAIGN_ALREADY_SENT',
        message: 'Cette campagne est déjà en cours d’envoi.',
      });
    }

    const link = {
      target: this.lireCible(campagne.linkTarget),
      value: campagne.linkValue ?? '',
    };

    const devices = await this.audienceDevices(campagne.audience);
    const tokens = [...new Set(devices.map((d) => d.token))];

    // Aucun appareil : on ne fait pas semblant d'envoyer. Aucun appel au
    // fournisseur, et une raison écrite noir sur blanc dans la campagne.
    const result =
      tokens.length > 0
        ? await this.notifications.pushToTokens(
            tokens,
            campagne.title,
            campagne.body,
            deepLinkToData(link),
          )
        : { sent: 0, invalidTokens: [] as string[] };

    // Une campagne doit AUSSI se retrouver dans la liste des notifications des
    // clients qui ont un compte : le push se perd (application fermée, refus
    // système), la notification en base reste.
    const destinataires = [
      ...new Set(
        devices
          .map((d) => d.userId)
          .filter((userId): userId is string => userId !== null),
      ),
    ];
    if (destinataires.length > 0) {
      try {
        await this.prisma.db.notification.createMany({
          data: destinataires.map((userId) => ({
            userId,
            type: 'PROMOTION' as const,
            title: campagne.title,
            body: campagne.body,
            linkTarget: link.target,
            linkValue: link.value,
            campaignId: campagne.id,
          })),
        });
      } catch {
        this.logger.warn('Campagne non recopiée dans les notifications.');
      }
    }

    const invalides = result.invalidTokens.length;
    const refuses = Math.max(0, tokens.length - result.sent - invalides);

    const campagneMaj = await this.prisma.db.notificationCampaign.update({
      where: { id },
      data: {
        status: result.sent > 0 ? 'SENT' : 'FAILED',
        sentAt: new Date(),
        targetCount: tokens.length,
        sentCount: result.sent,
        failedCount: refuses,
        invalidCount: invalides,
        lastError:
          tokens.length === 0
            ? 'Aucun appareil dans ce public : personne n’a été prévenu.'
            : (result.error ??
              (result.sent === 0
                ? 'Aucun envoi n’a abouti : service de notifications injoignable, ou notifications poussées désactivées sur ce serveur.'
                : null)),
      },
      select: campaignSelect,
    });

    await this.notifications.recordMessageLog({
      channel: 'PUSH',
      type: `CAMPAGNE_${campagne.category}`,
      to: `campagne:${id}`,
      status: result.sent > 0 ? 'SENT' : 'FAILED',
      error: result.error,
    });

    return campagneMaj;
  }

  /** Combien d'appareils ce public touche-t-il, maintenant ? */
  async countAudience(audience: CampaignAudience) {
    return this.prisma.db.pushDevice.count({
      where: this.audienceWhere(audience),
    });
  }

  private audienceDevices(audience: CampaignAudience) {
    return this.prisma.db.pushDevice.findMany({
      where: this.audienceWhere(audience),
      select: { token: true, userId: true },
    });
  }

  /**
   * Public d'une campagne.
   *
   * `promoOptIn` est la ligne rouge : quelqu'un qui a refusé les promotions ne
   * reçoit pas de campagne. Les envois de test visent les appareils des
   * responsables — jamais les clients, ce serait une promotion involontaire.
   */
  private audienceWhere(
    audience: CampaignAudience,
  ): Prisma.PushDeviceWhereInput {
    const base: Prisma.PushDeviceWhereInput = {
      isActive: true,
      promoOptIn: true,
    };

    switch (audience) {
      case 'AUTHENTICATED':
        return { ...base, userId: { not: null } };
      case 'TEST':
        return { ...base, user: { role: { in: ROLES_INTERNES } } };
      case 'ALL_OPTED_IN':
      default:
        return base;
    }
  }

  /** Une valeur de destination relue de la base ne doit jamais planter l'envoi. */
  private lireCible(valeur: string | null): NotificationTarget {
    return (NOTIFICATION_TARGETS as readonly string[]).includes(valeur ?? '')
      ? (valeur as NotificationTarget)
      : 'information';
  }
}
