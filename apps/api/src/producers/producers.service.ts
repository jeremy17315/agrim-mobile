import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  canTransitionProduction,
  isProductionEditable,
  type ProductionStatus,
} from '@agrim/contracts';

import { PrismaService } from '../prisma/prisma.service';
import type { CreateFarmDto } from './dto/create-farm.dto';
import type { CreateProductionDto } from './dto/create-production.dto';
import type { ReviewProductionDto } from './dto/review-production.dto';
import type { UpdateFarmDto } from './dto/update-farm.dto';

/**
 * Espace producteur.
 *
 * Règle d'isolation : un producteur n'accède qu'à ses propres parcelles et
 * déclarations. Chaque requête part de son `userId` (issu du JWT), jamais d'un
 * identifiant fourni par le client — sinon deviner un UUID suffirait à lire ou
 * modifier l'exploitation d'un autre.
 */
const farmSelect = {
  id: true,
  name: true,
  location: true,
  areaHectares: true,
  latitude: true,
  longitude: true,
  isActive: true,
} as const;

const productionSelect = {
  id: true,
  farmId: true,
  season: true,
  cropVariety: true,
  quantityKg: true,
  targetKg: true,
  harvestedAt: true,
  status: true,
  reviewNote: true,
  reviewedAt: true,
  createdAt: true,
  farm: { select: { name: true } },
} as const;

type ProductionRow = {
  farm: { name: string };
} & Record<string, unknown>;

/** Aplatit la relation pour coller au contrat partagé. */
function toProduction(row: ProductionRow) {
  const { farm, ...rest } = row;
  return { ...rest, farmName: farm.name };
}

@Injectable()
export class ProducersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrouve le producteur lié au compte connecté.
   *
   * Un compte au rôle PRODUCTEUR sans fiche producteur est une incohérence de
   * données : mieux vaut un message explicite qu'un écran vide inexplicable.
   */
  private async requireProducer(userId: string) {
    const producer = await this.prisma.db.producer.findUnique({
      where: { userId },
      select: { id: true, displayName: true, region: true },
    });
    if (!producer) {
      throw new NotFoundException({
        code: 'PRODUCER_NOT_FOUND',
        message: 'Aucune exploitation n’est rattachée à votre compte.',
      });
    }
    return producer;
  }

  /** Vérifie que la parcelle appartient bien au producteur. */
  private async requireOwnedFarm(producerId: string, farmId: string) {
    const farm = await this.prisma.db.farm.findFirst({
      where: { id: farmId, producerId },
      select: { id: true, isActive: true },
    });
    if (!farm) {
      throw new NotFoundException({
        code: 'FARM_NOT_FOUND',
        message: 'Cette parcelle est introuvable.',
      });
    }
    return farm;
  }

  /* ------------------------------ Synthèse ------------------------------- */

  async overview(userId: string) {
    const producer = await this.requireProducer(userId);

    const farms = await this.prisma.db.farm.findMany({
      where: { producerId: producer.id },
      select: { id: true, areaHectares: true, isActive: true },
    });
    const farmIds = farms.map((f) => f.id);

    // Seules les récoltes réceptionnées sont comptées : additionner les
    // déclarations en attente afficherait un total que rien ne garantit.
    const [received, pendingCount] = await Promise.all([
      this.prisma.db.production.aggregate({
        where: { farmId: { in: farmIds }, status: 'RECEIVED' },
        _sum: { quantityKg: true },
      }),
      this.prisma.db.production.count({
        where: { farmId: { in: farmIds }, status: 'DECLARED' },
      }),
    ]);

    return {
      id: producer.id,
      displayName: producer.displayName,
      region: producer.region,
      farmCount: farms.filter((f) => f.isActive).length,
      totalAreaHectares: Number(
        farms
          .filter((f) => f.isActive)
          .reduce((sum, f) => sum + (f.areaHectares ?? 0), 0)
          .toFixed(2),
      ),
      receivedKg: received._sum.quantityKg ?? 0,
      pendingCount,
    };
  }

  /* ------------------------------ Parcelles ------------------------------ */

  async listFarms(userId: string) {
    const producer = await this.requireProducer(userId);

    const farms = await this.prisma.db.farm.findMany({
      where: { producerId: producer.id },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
      select: { ...farmSelect, _count: { select: { productions: true } } },
    });

    return farms.map(({ _count, ...farm }) => ({
      ...farm,
      productionCount: _count.productions,
    }));
  }

  async createFarm(userId: string, dto: CreateFarmDto) {
    const producer = await this.requireProducer(userId);

    return this.prisma.db.farm.create({
      data: {
        producerId: producer.id,
        name: dto.name,
        location: dto.location ?? null,
        areaHectares: dto.areaHectares ?? null,
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
      },
      select: farmSelect,
    });
  }

  async updateFarm(userId: string, farmId: string, dto: UpdateFarmDto) {
    const producer = await this.requireProducer(userId);
    await this.requireOwnedFarm(producer.id, farmId);

    return this.prisma.db.farm.update({
      where: { id: farmId },
      // `undefined` laisse la colonne intacte : une mise à jour partielle ne
      // doit pas effacer les champs absents de la requête.
      data: {
        name: dto.name,
        location: dto.location,
        areaHectares: dto.areaHectares,
        latitude: dto.latitude,
        longitude: dto.longitude,
        isActive: dto.isActive,
      },
      select: farmSelect,
    });
  }

  /**
   * Suppression d'une parcelle.
   *
   * Une parcelle porteuse d'historique n'est jamais supprimée : la retirer
   * effacerait les productions déjà réceptionnées (cascade). On la désactive,
   * ce qui la sort des saisies sans perdre la trace.
   */
  async deleteFarm(userId: string, farmId: string) {
    const producer = await this.requireProducer(userId);
    await this.requireOwnedFarm(producer.id, farmId);

    const productions = await this.prisma.db.production.count({
      where: { farmId },
    });

    if (productions > 0) {
      await this.prisma.db.farm.update({
        where: { id: farmId },
        data: { isActive: false },
      });
      return { deleted: false, deactivated: true };
    }

    await this.prisma.db.farm.delete({ where: { id: farmId } });
    return { deleted: true, deactivated: false };
  }

  /* ----------------------------- Productions ----------------------------- */

  async listProductions(
    userId: string,
    filters: { farmId?: string; status?: ProductionStatus } = {},
  ) {
    const producer = await this.requireProducer(userId);

    if (filters.farmId) {
      await this.requireOwnedFarm(producer.id, filters.farmId);
    }

    const rows = await this.prisma.db.production.findMany({
      where: {
        farm: { producerId: producer.id },
        ...(filters.farmId ? { farmId: filters.farmId } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: productionSelect,
    });

    return rows.map(toProduction);
  }

  async createProduction(userId: string, dto: CreateProductionDto) {
    const producer = await this.requireProducer(userId);
    const farm = await this.requireOwnedFarm(producer.id, dto.farmId);

    // Déclarer sur une parcelle mise en jachère est presque toujours une
    // erreur de sélection : on refuse plutôt que d'enregistrer en silence.
    if (!farm.isActive) {
      throw new BadRequestException({
        code: 'FARM_INACTIVE',
        message: 'Cette parcelle est inactive. Réactivez-la pour déclarer.',
      });
    }

    const row = await this.prisma.db.production.create({
      data: {
        farmId: dto.farmId,
        season: dto.season,
        cropVariety: dto.cropVariety,
        quantityKg: dto.quantityKg,
        targetKg: dto.targetKg ?? null,
        harvestedAt: dto.harvestedAt ? new Date(dto.harvestedAt) : null,
      },
      select: productionSelect,
    });

    return toProduction(row);
  }

  /** Correction d'une déclaration, tant qu'elle n'a pas été examinée. */
  async updateProduction(
    userId: string,
    productionId: string,
    dto: Partial<CreateProductionDto>,
  ) {
    const producer = await this.requireProducer(userId);

    const existing = await this.prisma.db.production.findFirst({
      where: { id: productionId, farm: { producerId: producer.id } },
      select: { id: true, status: true },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'PRODUCTION_NOT_FOUND',
        message: 'Cette déclaration est introuvable.',
      });
    }

    if (!isProductionEditable(existing.status)) {
      throw new ForbiddenException({
        code: 'PRODUCTION_NOT_EDITABLE',
        message: 'Cette déclaration a déjà été examinée.',
      });
    }

    // Changer de parcelle reste possible, à condition qu'elle soit à soi.
    if (dto.farmId) await this.requireOwnedFarm(producer.id, dto.farmId);

    const row = await this.prisma.db.production.update({
      where: { id: productionId },
      data: {
        farmId: dto.farmId,
        season: dto.season,
        cropVariety: dto.cropVariety,
        quantityKg: dto.quantityKg,
        targetKg: dto.targetKg,
        harvestedAt: dto.harvestedAt ? new Date(dto.harvestedAt) : undefined,
      },
      select: productionSelect,
    });

    return toProduction(row);
  }

  async deleteProduction(userId: string, productionId: string) {
    const producer = await this.requireProducer(userId);

    const existing = await this.prisma.db.production.findFirst({
      where: { id: productionId, farm: { producerId: producer.id } },
      select: { id: true, status: true },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'PRODUCTION_NOT_FOUND',
        message: 'Cette déclaration est introuvable.',
      });
    }

    if (!isProductionEditable(existing.status)) {
      throw new ForbiddenException({
        code: 'PRODUCTION_NOT_EDITABLE',
        message: 'Cette déclaration a déjà été examinée.',
      });
    }

    await this.prisma.db.production.delete({ where: { id: productionId } });
    return { deleted: true };
  }

  /* ------------------------------- Revue --------------------------------- */

  /**
   * Vérification par la coopérative (gestionnaire, admin, DG).
   *
   * Volontairement hors du périmètre producteur : c'est ce qui donne sa valeur
   * à la déclaration. Le contrôle de rôle est porté par le contrôleur.
   */
  /**
   * File de revue de la coopérative, tous producteurs confondus.
   *
   * Par défaut on ne remonte que les déclarations en attente d'arbitrage
   * (`DECLARED` et `CONFIRMED`) : c'est la seule liste sur laquelle le
   * gestionnaire doit agir. Les plus anciennes d'abord — une déclaration
   * oubliée bloque un producteur.
   */
  async listReviewableProductions(filters: { status?: ProductionStatus } = {}) {
    const rows = await this.prisma.db.production.findMany({
      where: filters.status
        ? { status: filters.status }
        : { status: { in: ['DECLARED', 'CONFIRMED'] } },
      orderBy: { createdAt: 'asc' },
      select: {
        ...productionSelect,
        farm: {
          select: {
            name: true,
            producer: {
              select: {
                id: true,
                displayName: true,
                user: { select: { phone: true } },
              },
            },
          },
        },
      },
    });

    return rows.map((row) => {
      const { farm, ...rest } = row;
      return {
        ...rest,
        farmName: farm.name,
        producerId: farm.producer.id,
        producerName: farm.producer.displayName,
        producerPhone: farm.producer.user.phone,
      };
    });
  }

  async reviewProduction(productionId: string, dto: ReviewProductionDto) {
    const existing = await this.prisma.db.production.findUnique({
      where: { id: productionId },
      select: { id: true, status: true },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'PRODUCTION_NOT_FOUND',
        message: 'Cette déclaration est introuvable.',
      });
    }

    if (!canTransitionProduction(existing.status, dto.status)) {
      throw new BadRequestException({
        code: 'INVALID_PRODUCTION_TRANSITION',
        message: 'Cette décision n’est pas possible depuis l’état actuel.',
        details: { from: existing.status, to: dto.status },
      });
    }

    // Un rejet sans motif laisse le producteur sans recours.
    if (dto.status === 'REJECTED' && !dto.reviewNote?.trim()) {
      throw new BadRequestException({
        code: 'REVIEW_NOTE_REQUIRED',
        message: 'Indiquez le motif du rejet.',
      });
    }

    const row = await this.prisma.db.production.update({
      where: { id: productionId },
      data: {
        status: dto.status,
        reviewNote: dto.reviewNote?.trim() ?? null,
        reviewedAt: new Date(),
      },
      select: productionSelect,
    });

    return toProduction(row);
  }
}
