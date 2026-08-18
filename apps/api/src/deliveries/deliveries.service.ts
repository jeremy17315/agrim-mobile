import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  canTransitionDelivery,
  submitDeliveryProofSchema,
  type DeliveryStatus,
  type OrderStatus,
} from '@agrim/contracts';

import { PrismaService } from '../prisma/prisma.service';
import type { SubmitProofDto } from './dto/submit-proof.dto';
import type { UpdateDeliveryStatusDto } from './dto/update-delivery-status.dto';

/** Projection commune : le livreur voit ce qu'il lui faut pour livrer, rien de plus. */
const deliverySelect = {
  id: true,
  status: true,
  assignedAt: true,
  acceptedAt: true,
  pickedUpAt: true,
  deliveredAt: true,
  failureReason: true,
  proofMethods: true,
  proofReceivedBy: true,
  proofSubmittedAt: true,
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
    PICKED_UP: 'OUT_FOR_DELIVERY',
    IN_TRANSIT: 'OUT_FOR_DELIVERY',
    DELIVERED: 'DELIVERED',
  };

@Injectable()
export class DeliveriesService {
  constructor(private readonly prisma: PrismaService) {}

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
      select: {
        id: true,
        status: true,
        orderId: true,
        proofSubmittedAt: true,
      },
    });
    if (!delivery) {
      throw new NotFoundException({
        code: 'DELIVERY_NOT_FOUND',
        message: 'Cette livraison est introuvable.',
      });
    }

    if (!canTransitionDelivery(delivery.status, dto.status)) {
      throw new ConflictException({
        code: 'INVALID_DELIVERY_TRANSITION',
        message: 'Cette étape n’est pas possible depuis l’état actuel.',
        details: { from: delivery.status, to: dto.status },
      });
    }

    // Règle centrale de la phase : pas de livraison validée sans preuve.
    if (dto.status === 'DELIVERED' && !delivery.proofSubmittedAt) {
      throw new ConflictException({
        code: 'PROOF_REQUIRED',
        message: 'Enregistrez la preuve de livraison avant de valider.',
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
    if (dto.status === 'PICKED_UP') timestamps.pickedUpAt = now;
    if (dto.status === 'DELIVERED') timestamps.deliveredAt = now;

    const nextOrderStatus = ORDER_STATUS_FOR_DELIVERY[dto.status];

    return this.prisma.db.$transaction(async (tx) => {
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
        }
      }

      return updated;
    });
  }

  /**
   * Enregistre la preuve de livraison.
   *
   * La validation fine (méthodes cohérentes avec les fichiers, nom du
   * réceptionnaire exigé avec une signature) vit dans le contrat partagé et
   * s'applique ici comme côté mobile.
   */
  async submitProof(courierId: string, id: string, dto: SubmitProofDto) {
    const delivery = await this.prisma.db.delivery.findFirst({
      where: { id, courierId },
      select: { id: true, status: true },
    });
    if (!delivery) {
      throw new NotFoundException({
        code: 'DELIVERY_NOT_FOUND',
        message: 'Cette livraison est introuvable.',
      });
    }

    // Une preuve n'a de sens que sur une course engagée et non close.
    if (delivery.status === 'DELIVERED' || delivery.status === 'FAILED') {
      throw new ConflictException({
        code: 'DELIVERY_ALREADY_CLOSED',
        message: 'Cette livraison est déjà terminée.',
      });
    }
    if (delivery.status !== 'PICKED_UP' && delivery.status !== 'IN_TRANSIT') {
      throw new ConflictException({
        code: 'DELIVERY_NOT_STARTED',
        message:
          'Récupérez d’abord la commande avant d’enregistrer une preuve.',
      });
    }

    // Règle de cohérence PARTAGÉE avec le mobile : une méthode retenue exige
    // son fichier, un fichier sans méthode est refusé, une signature exige le
    // nom du réceptionnaire. Une seule implémentation, donc aucune divergence.
    const parsed = submitDeliveryProofSchema.safeParse({
      deliveryId: id,
      methods: dto.methods,
      signatureFileId: dto.signatureFileId,
      photoFileId: dto.photoFileId,
      receivedBy: dto.receivedBy,
      note: dto.note,
      position: dto.position
        ? {
            latitude: dto.position.latitude,
            longitude: dto.position.longitude,
            accuracy: null,
            heading: null,
            speed: null,
            recordedAt: new Date().toISOString(),
          }
        : null,
    });
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_PROOF',
        message: 'La preuve de livraison est incomplète.',
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    await this.assertFilesExist(dto);

    return this.prisma.db.delivery.update({
      where: { id },
      data: {
        proofMethods: dto.methods,
        proofSignatureFile: dto.signatureFileId ?? null,
        proofPhotoFile: dto.photoFileId ?? null,
        proofReceivedBy: dto.receivedBy?.trim() ?? null,
        proofNote: dto.note?.trim() ?? null,
        proofLatitude: dto.position?.latitude ?? null,
        proofLongitude: dto.position?.longitude ?? null,
        proofSubmittedAt: new Date(),
      },
      select: deliverySelect,
    });
  }

  /**
   * Un identifiant de fichier inexistant produirait une preuve vide au moment
   * du litige — c'est-à-dire trop tard. On vérifie à l'enregistrement.
   */
  private async assertFilesExist(dto: SubmitProofDto) {
    const ids = [dto.signatureFileId, dto.photoFileId].filter(
      (value): value is string => typeof value === 'string',
    );
    if (ids.length === 0) return;

    const found = await this.prisma.db.fileAsset.count({
      where: { id: { in: ids } },
    });
    if (found !== ids.length) {
      throw new BadRequestException({
        code: 'PROOF_FILE_NOT_FOUND',
        message: 'Le fichier de preuve est introuvable.',
      });
    }
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
    return existing
      ? this.prisma.db.delivery.update({
          where: { id: existing.id },
          data: { courierId, status: 'ASSIGNED', assignedAt: now },
          select: deliverySelect,
        })
      : this.prisma.db.delivery.create({
          data: {
            orderId: order.id,
            addressId: order.addressId,
            courierId,
            status: 'ASSIGNED',
            assignedAt: now,
          },
          select: deliverySelect,
        });
  }
}
