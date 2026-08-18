import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  TRACKING_CONFIG,
  isTrackable,
  type DeliveryStatus,
} from '@agrim/contracts';

import { PrismaService } from '../prisma/prisma.service';
import type { PushLocationsDto } from './dto/push-locations.dto';

/** Rayon terrestre moyen, en mètres. */
const EARTH_RADIUS_M = 6_371_000;

/**
 * Distance à vol d'oiseau entre deux points (formule de haversine).
 *
 * Volontairement pas un calcul d'itinéraire : estimer une distance routière
 * exigerait un fournisseur externe. La valeur sert à afficher un ordre de
 * grandeur et à calculer une ETA approximative, ce qui est annoncé comme tel
 * côté client.
 */
export function haversineMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(to.latitude - from.latitude);
  const dLon = toRad(to.longitude - from.longitude);
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a)));
}

/**
 * Vitesse retenue pour l'estimation, en m/s (~22 km/h).
 *
 * Calibrée pour une moto en ville ivoirienne, circulation dense comprise.
 * Centralisée ici plutôt que dispersée : c'est un paramètre à ajuster avec les
 * données réelles d'exploitation.
 */
const ASSUMED_SPEED_MPS = 6.1;

@Injectable()
export class TrackingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Enregistre un lot de positions émises par le livreur.
   *
   * Les points arrivent groupés : en zone de couverture faible, le mobile les
   * met en file puis les rejoue. `skipDuplicates` neutralise les rejeux, la
   * contrainte d'unicité garantissant qu'un même instant n'entre qu'une fois.
   */
  async pushLocations(courierId: string, dto: PushLocationsDto) {
    const delivery = await this.prisma.db.delivery.findFirst({
      where: { id: dto.deliveryId, courierId },
      select: { id: true, status: true },
    });
    if (!delivery) {
      throw new NotFoundException({
        code: 'DELIVERY_NOT_FOUND',
        message: 'Cette livraison est introuvable.',
      });
    }

    // Minimisation : hors course engagée, aucune position n'est conservée.
    if (!isTrackable(delivery.status as DeliveryStatus)) {
      throw new ConflictException({
        code: 'TRACKING_NOT_ACTIVE',
        message: 'Le suivi n’est actif que pendant une livraison en cours.',
      });
    }

    const result = await this.prisma.db.deliveryLocation.createMany({
      data: dto.points.map((point) => ({
        deliveryId: delivery.id,
        latitude: point.latitude,
        longitude: point.longitude,
        accuracy: point.accuracy ?? null,
        heading: point.heading ?? null,
        speed: point.speed ?? null,
        recordedAt: new Date(point.recordedAt),
      })),
      skipDuplicates: true,
    });

    return { accepted: result.count, received: dto.points.length };
  }

  /**
   * Vue de suivi destinée au client.
   *
   * Volontairement pauvre : ni trajet complet, ni numéro personnel du livreur,
   * ni position hors livraison active. Le client a besoin de savoir où en est
   * sa commande, pas de surveiller quelqu'un.
   */
  async getTracking(userId: string, reference: string) {
    const order = await this.prisma.db.order.findFirst({
      where: { reference, userId },
      select: {
        reference: true,
        address: {
          select: { latitude: true, longitude: true, landmark: true },
        },
        delivery: {
          select: {
            id: true,
            status: true,
            courier: {
              select: { firstName: true },
            },
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Cette commande est introuvable.',
      });
    }
    if (!order.delivery) {
      throw new NotFoundException({
        code: 'DELIVERY_NOT_FOUND',
        message: 'Aucune livraison n’est encore associée à cette commande.',
      });
    }

    const trackable = isTrackable(order.delivery.status as DeliveryStatus);

    // La position n'est lue que si le suivi est actif : inutile d'exposer le
    // dernier point d'une course terminée.
    const last = trackable
      ? await this.prisma.db.deliveryLocation.findFirst({
          where: { deliveryId: order.delivery.id },
          orderBy: { recordedAt: 'desc' },
          select: {
            latitude: true,
            longitude: true,
            accuracy: true,
            heading: true,
            speed: true,
            recordedAt: true,
          },
        })
      : null;

    const ageSeconds = last
      ? (Date.now() - last.recordedAt.getTime()) / 1000
      : null;
    // Une position figée depuis trop longtemps est trompeuse : mieux vaut
    // annoncer « indisponible » qu'afficher un marqueur périmé.
    const isLive =
      trackable &&
      ageSeconds !== null &&
      ageSeconds <= TRACKING_CONFIG.stalePositionSeconds;

    const destination = {
      latitude: order.address.latitude,
      longitude: order.address.longitude,
      landmark: order.address.landmark,
    };

    let remainingMeters: number | null = null;
    let etaSeconds: number | null = null;
    let estimatedArrivalAt: string | null = null;

    if (
      last &&
      isLive &&
      destination.latitude !== null &&
      destination.longitude !== null
    ) {
      remainingMeters = haversineMeters(last, {
        latitude: destination.latitude,
        longitude: destination.longitude,
      });
      etaSeconds = Math.round(remainingMeters / ASSUMED_SPEED_MPS);
      estimatedArrivalAt = new Date(
        Date.now() + etaSeconds * 1000,
      ).toISOString();
    }

    return {
      deliveryId: order.delivery.id,
      orderReference: order.reference,
      status: order.delivery.status,
      currentPosition: last
        ? {
            latitude: last.latitude,
            longitude: last.longitude,
            accuracy: last.accuracy,
            heading: last.heading,
            speed: last.speed,
            recordedAt: last.recordedAt.toISOString(),
          }
        : null,
      destination,
      remainingMeters,
      etaSeconds,
      estimatedArrivalAt,
      lastUpdateAt: last?.recordedAt.toISOString() ?? null,
      isLive,
      courier: order.delivery.courier
        ? {
            firstName: order.delivery.courier.firstName,
            // Numéro de service, jamais la ligne personnelle du livreur.
            contactPhone: null,
            vehicleType: null,
          }
        : null,
    };
  }

  /**
   * Trajet parcouru, réservé au livreur concerné (relecture de sa course).
   * Le client n'y a pas accès : il n'a pas besoin de l'historique complet.
   */
  async getRoute(courierId: string, deliveryId: string) {
    const delivery = await this.prisma.db.delivery.findUnique({
      where: { id: deliveryId },
      select: { id: true, courierId: true },
    });
    if (!delivery) {
      throw new NotFoundException({
        code: 'DELIVERY_NOT_FOUND',
        message: 'Cette livraison est introuvable.',
      });
    }
    if (delivery.courierId !== courierId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN_ROLE',
        message: 'Cette course ne vous est pas affectée.',
      });
    }

    const points = await this.prisma.db.deliveryLocation.findMany({
      where: { deliveryId },
      orderBy: { recordedAt: 'asc' },
      select: { latitude: true, longitude: true, recordedAt: true },
    });

    return {
      deliveryId,
      points: points.map((p) => ({
        latitude: p.latitude,
        longitude: p.longitude,
        recordedAt: p.recordedAt.toISOString(),
      })),
    };
  }

  /**
   * Purge des traces après livraison (minimisation des données).
   * Appelée par une tâche planifiée ; exposée ici pour rester testable.
   */
  async purgeOldTraces(now = new Date()) {
    const cutoff = new Date(
      now.getTime() -
        TRACKING_CONFIG.retentionDaysAfterDelivery * 24 * 3600 * 1000,
    );

    const result = await this.prisma.db.deliveryLocation.deleteMany({
      where: {
        delivery: {
          status: { in: ['DELIVERED', 'FAILED'] },
          updatedAt: { lt: cutoff },
        },
      },
    });
    return { deleted: result.count };
  }
}
