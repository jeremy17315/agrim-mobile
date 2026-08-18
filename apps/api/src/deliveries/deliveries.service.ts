import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  canTransitionDelivery,
  isCourierSettable,
  type DeliveryStatus,
  type OrderStatus,
} from '@agrim/contracts';

import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { DeliveryOtpService } from './delivery-otp.service';
import type { UpdateDeliveryStatusDto } from './dto/update-delivery-status.dto';
import type { VerifyOtpDto } from './dto/verify-otp.dto';

/** Projection commune : le livreur voit ce qu'il lui faut pour livrer, rien de plus. */
const deliverySelect = {
  id: true,
  status: true,
  assignedAt: true,
  acceptedAt: true,
  inTransitAt: true,
  arrivedAt: true,
  deliveredAt: true,
  failureReason: true,
  otpVerifiedAt: true,
  order: {
    select: {
      reference: true,
      total: true,
      status: true,
      items: {
        select: {
          id: true,
          productName: true,
          variantLabel: true,
          quantity: true,
        },
      },
      payment: { select: { method: true, status: true } },
    },
  },
  address: {
    select: {
      label: true,
      city: true,
      commune: true,
      district: true,
      landmark: true,
      instructions: true,
      contactPhone: true,
      latitude: true,
      longitude: true,
    },
  },
} as const;

/**
 * Quand la livraison avance, la commande avance avec elle. Cette table évite
 * qu'un client voie « en préparation » alors que le livreur roule déjà.
 */
const ORDER_STATUS_FOR_DELIVERY: Partial<Record<DeliveryStatus, OrderStatus>> =
  {
    IN_TRANSIT: 'OUT_FOR_DELIVERY',
    ARRIVED: 'OUT_FOR_DELIVERY',
    DELIVERED: 'DELIVERED',
  };

@Injectable()
export class DeliveriesService {
  private readonly logger = new Logger(DeliveriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly otp: DeliveryOtpService,
  ) {}

  /** Tournée du livreur : ses courses en cours, les plus anciennes d'abord. */
  listMine(courierId: string, includeDone: boolean) {
    return this.prisma.db.delivery.findMany({
      where: {
        courierId,
        ...(includeDone
          ? {}
          : { status: { notIn: ['DELIVERED', 'FAILED'] as DeliveryStatus[] } }),
      },
      select: deliverySelect,
      orderBy: [{ assignedAt: 'asc' }],
    });
  }

  async findOne(courierId: string, id: string) {
    const delivery = await this.prisma.db.delivery.findFirst({
      where: { id, courierId },
      select: deliverySelect,
    });
    if (!delivery) {
      // NOT_FOUND et non FORBIDDEN : ne pas confirmer l'existence d'une course
      // à un livreur qui n'y a pas droit.
      throw new NotFoundException({
        code: 'DELIVERY_NOT_FOUND',
        message: 'Cette livraison est introuvable.',
      });
    }
    return delivery;
  }

  /**
   * Avance la course. Toute transition passe par la table du contrat : un
   * livreur ne peut pas sauter d'ACCEPTED à DELIVERED sans passer par le
   * trajet, ni valider une livraison sans preuve.
   */
  async updateStatus(
    courierId: string,
    id: string,
    dto: UpdateDeliveryStatusDto,
  ) {
    const delivery = await this.prisma.db.delivery.findFirst({
      where: { id, courierId },
      select: { id: true, status: true, orderId: true },
    });
    if (!delivery) {
      throw new NotFoundException({
        code: 'DELIVERY_NOT_FOUND',
        message: 'Cette livraison est introuvable.',
      });
    }

    // Frontière de responsabilité : le terrain fait avancer la course jusqu'à
    // l'arrivée, jamais au-delà. `OTP_VERIFIED` et `DELIVERED` n'appartiennent
    // qu'au backend, après vérification du code remis par le client.
    if (!isCourierSettable(dto.status)) {
      throw new ForbiddenException({
        code: 'COURIER_CANNOT_SET_STATUS',
        message:
          'La livraison se valide avec le code du client, pas manuellement.',
      });
    }

    if (!canTransitionDelivery(delivery.status, dto.status)) {
      throw new ConflictException({
        code: 'INVALID_DELIVERY_TRANSITION',
        message: 'Cette étape n’est pas possible depuis l’état actuel.',
        details: { from: delivery.status, to: dto.status },
      });
    }

    if (dto.status === 'FAILED' && !dto.failureReason?.trim()) {
      throw new BadRequestException({
        code: 'FAILURE_REASON_REQUIRED',
        message: 'Indiquez la raison de l’échec.',
      });
    }

    const now = new Date();
    const timestamps: Record<string, Date> = {};
    if (dto.status === 'ACCEPTED') timestamps.acceptedAt = now;
    if (dto.status === 'IN_TRANSIT') timestamps.inTransitAt = now;
    if (dto.status === 'ARRIVED') timestamps.arrivedAt = now;

    const nextOrderStatus = ORDER_STATUS_FOR_DELIVERY[dto.status];

    const result = await this.prisma.db.$transaction(async (tx) => {
      const updated = await tx.delivery.update({
        where: { id },
        data: {
          status: dto.status,
          ...timestamps,
          ...(dto.status === 'FAILED'
            ? { failureReason: dto.failureReason?.trim() }
            : {}),
        },
        select: deliverySelect,
      });

      // La commande suit la course, sans jamais reculer.
      let orderStatusChanged: OrderStatus | null = null;
      if (nextOrderStatus) {
        const order = await tx.order.findUniqueOrThrow({
          where: { id: delivery.orderId },
          select: { status: true },
        });
        if (order.status !== nextOrderStatus && order.status !== 'CANCELLED') {
          await tx.order.update({
            where: { id: delivery.orderId },
            data: { status: nextOrderStatus },
          });
          await tx.orderEvent.create({
            data: {
              orderId: delivery.orderId,
              status: nextOrderStatus,
              actorId: courierId,
            },
          });
          orderStatusChanged = nextOrderStatus;
        }
      }

      return { updated, orderStatusChanged: orderStatusChanged };
    });

    // Départ du livreur : le client reçoit son code de validation, au moment
    // où il lui devient utile. Une erreur d'envoi ne doit pas annuler le
    // changement de statut déjà acté — le client pourra faire renvoyer le code.
    if (dto.status === 'IN_TRANSIT') {
      try {
        await this.issueOtpToClient(id);
      } catch {
        this.logger.warn(`Code de livraison non transmis (livraison ${id}).`);
      }
    }

    // Le client est prévenu du mouvement de sa commande, pas de celui de la
    // course : « en cours de livraison » lui parle, « IN_TRANSIT » non.
    if (result.orderStatusChanged) {
      const owner = await this.prisma.db.order.findUnique({
        where: { id: delivery.orderId },
        select: { userId: true, reference: true },
      });
      if (owner) {
        await this.notifications.notifyOrderStatus({
          userId: owner.userId,
          status: result.orderStatusChanged,
          reference: owner.reference,
          orderId: delivery.orderId,
        });
      }
    }

    return result.updated;
  }

  /* -------------------------- Validation par OTP ------------------------- */

  /**
   * Émet le code de validation et l'envoie au CLIENT.
   *
   * Appelé au départ du livreur : le client reçoit son code au moment où il
   * en a besoin, pas des heures à l'avance. Le code ne transite jamais par la
   * réponse HTTP du livreur — seul le canal de notification du client le porte.
   */
  private async issueOtpToClient(
    deliveryId: string,
    options: { isResend?: boolean } = {},
  ): Promise<void> {
    const delivery = await this.prisma.db.delivery.findUniqueOrThrow({
      where: { id: deliveryId },
      select: {
        orderId: true,
        order: { select: { userId: true, reference: true } },
      },
    });

    const { code } = await this.otp.issue(deliveryId, options);

    await this.notifications.notify({
      userId: delivery.order.userId,
      type: 'DELIVERY_OTP',
      reference: delivery.order.reference,
      orderId: delivery.orderId,
      values: { code },
    });
  }

  /**
   * Régénère un code à la demande du client.
   *
   * Réservé au propriétaire de la commande : c'est lui qui constate qu'il n'a
   * rien reçu, ou que son code a expiré. Le livreur n'a aucun moyen de
   * déclencher un renvoi, et ne verrait de toute façon pas le résultat.
   */
  async resendOtp(userId: string, reference: string) {
    const order = await this.prisma.db.order.findFirst({
      where: { reference, userId },
      select: { delivery: { select: { id: true, status: true } } },
    });

    if (!order?.delivery) {
      throw new NotFoundException({
        code: 'DELIVERY_NOT_FOUND',
        message: 'Cette livraison est introuvable.',
      });
    }

    // Avant le départ du livreur, un code n'aurait aucune utilité ; après la
    // clôture, il n'en a plus.
    const eligible: DeliveryStatus[] = ['IN_TRANSIT', 'ARRIVED'];
    if (!eligible.includes(order.delivery.status)) {
      throw new ConflictException({
        code: 'OTP_NOT_AVAILABLE',
        message:
          'Le code sera disponible dès que le livreur sera en route avec votre commande.',
      });
    }

    await this.issueOtpToClient(order.delivery.id, { isResend: true });
    return this.otp.status(order.delivery.id);
  }

  /**
   * Vérifie le code saisi par le livreur et clôt la livraison.
   *
   * C'est le SEUL chemin menant à `DELIVERED`. Les cinq conditions (code
   * exact, non expiré, non consommé, livraison concernée, livreur autorisé)
   * sont contrôlées par `DeliveryOtpService.verify` ; la clôture qui suit est
   * transactionnelle, pour qu'un code consommé corresponde toujours à une
   * commande livrée.
   */
  async verifyOtp(courierId: string, id: string, dto: VerifyOtpDto) {
    const delivery = await this.prisma.db.delivery.findFirst({
      where: { id, courierId },
      select: { id: true, status: true, orderId: true },
    });
    if (!delivery) {
      throw new NotFoundException({
        code: 'DELIVERY_NOT_FOUND',
        message: 'Cette livraison est introuvable.',
      });
    }

    if (delivery.status === 'DELIVERED' || delivery.status === 'FAILED') {
      throw new ConflictException({
        code: 'DELIVERY_ALREADY_CLOSED',
        message: 'Cette livraison est déjà terminée.',
      });
    }

    // Le code se saisit à la remise, donc sur place. Exiger l'arrivée évite
    // qu'une course soit validée depuis le dépôt.
    if (delivery.status !== 'ARRIVED') {
      throw new ConflictException({
        code: 'DELIVERY_NOT_ARRIVED',
        message: 'Signalez votre arrivée avant de saisir le code du client.',
      });
    }

    // Lève si le code est refusé : rien n'est modifié dans ce cas.
    await this.otp.verify({ deliveryId: id, courierId, code: dto.code });

    const now = new Date();
    const updated = await this.prisma.db.$transaction(async (tx) => {
      // OTP_VERIFIED puis DELIVERED : les deux étapes du contrat sont
      // franchies ici, par le backend, dans la même transaction.
      const result = await tx.delivery.update({
        where: { id },
        data: {
          status: 'DELIVERED',
          otpVerifiedAt: now,
          deliveredAt: now,
          // Traçabilité seulement : une position absente n'empêche rien.
          otpLatitude: dto.position?.latitude ?? null,
          otpLongitude: dto.position?.longitude ?? null,
        },
        select: deliverySelect,
      });

      const order = await tx.order.findUniqueOrThrow({
        where: { id: delivery.orderId },
        select: { status: true },
      });
      if (order.status !== 'DELIVERED' && order.status !== 'CANCELLED') {
        await tx.order.update({
          where: { id: delivery.orderId },
          data: { status: 'DELIVERED' },
        });
        await tx.orderEvent.create({
          data: {
            orderId: delivery.orderId,
            status: 'DELIVERED',
            actorId: courierId,
          },
        });
      }

      return result;
    });

    const owner = await this.prisma.db.order.findUnique({
      where: { id: delivery.orderId },
      select: { userId: true, reference: true },
    });
    if (owner) {
      await this.notifications.notifyOrderStatus({
        userId: owner.userId,
        status: 'DELIVERED',
        reference: owner.reference,
        orderId: delivery.orderId,
      });
    }

    return updated;
  }

  /** État du code, sans jamais le divulguer au livreur. */
  async otpStatus(courierId: string, id: string) {
    const delivery = await this.prisma.db.delivery.findFirst({
      where: { id, courierId },
      select: { id: true },
    });
    if (!delivery) {
      throw new NotFoundException({
        code: 'DELIVERY_NOT_FOUND',
        message: 'Cette livraison est introuvable.',
      });
    }
    return this.otp.status(id);
  }

  /* ----------------------------- Affectation ---------------------------- */

  /**
   * Affectation d'un livreur par le gestionnaire. Séparée des actions du
   * livreur : ce n'est pas le même rôle, ni la même responsabilité.
   */
  async assign(orderReference: string, courierId: string) {
    const order = await this.prisma.db.order.findUnique({
      where: { reference: orderReference },
      select: {
        id: true,
        addressId: true,
        status: true,
        delivery: { select: { id: true } },
      },
    });
    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Cette commande est introuvable.',
      });
    }
    if (order.status === 'CANCELLED') {
      throw new ConflictException({
        code: 'ORDER_CANCELLED',
        message: 'Cette commande est annulée.',
      });
    }

    const courier = await this.prisma.db.user.findFirst({
      where: { id: courierId, role: 'LIVREUR', isActive: true },
      select: { id: true },
    });
    if (!courier) {
      throw new BadRequestException({
        code: 'COURIER_NOT_FOUND',
        message: 'Ce livreur est introuvable ou inactif.',
      });
    }

    const existing = order.delivery
      ? await this.prisma.db.delivery.findUniqueOrThrow({
          where: { id: order.delivery.id },
          select: { id: true, status: true },
        })
      : null;

    // Réassigner une course déjà acceptée ferait disparaître une livraison
    // sous les pieds du livreur qui roule.
    if (
      existing &&
      existing.status !== 'UNASSIGNED' &&
      existing.status !== 'ASSIGNED'
    ) {
      throw new ConflictException({
        code: 'DELIVERY_ALREADY_STARTED',
        message: 'Cette livraison est déjà en cours.',
      });
    }

    const now = new Date();
    const delivery = existing
      ? await this.prisma.db.delivery.update({
          where: { id: existing.id },
          data: { courierId, status: 'ASSIGNED', assignedAt: now },
          select: deliverySelect,
        })
      : await this.prisma.db.delivery.create({
          data: {
            orderId: order.id,
            addressId: order.addressId,
            courierId,
            status: 'ASSIGNED',
            assignedAt: now,
          },
          select: deliverySelect,
        });

    // Ici le destinataire est le livreur, pas le client : c'est lui qui doit
    // ouvrir l'application.
    await this.notifications.notify({
      userId: courierId,
      type: 'DELIVERY_ASSIGNED',
      reference: delivery.order.reference,
      orderId: order.id,
    });

    return delivery;
  }
}
