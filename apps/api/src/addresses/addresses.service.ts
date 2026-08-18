import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import type { CreateAddressDto } from './dto/create-address.dto';

/** Jamais de SELECT * : on n'expose que ce dont le mobile a besoin. */
const addressSelect = {
  id: true,
  label: true,
  city: true,
  commune: true,
  district: true,
  landmark: true,
  instructions: true,
  contactPhone: true,
  latitude: true,
  longitude: true,
  isDefault: true,
} as const;

@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Adresses de l'utilisateur courant, l'adresse par défaut en tête. */
  list(userId: string) {
    return this.prisma.db.address.findMany({
      where: { userId },
      select: addressSelect,
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async create(userId: string, dto: CreateAddressDto) {
    // Le carnet doit TOUJOURS proposer une adresse par défaut, sinon le tunnel
    // de commande n'a rien à présélectionner. On teste donc l'absence d'adresse
    // par défaut — et non l'absence d'adresse : une adresse par défaut peut
    // avoir été déclassée (cas d'une adresse conservée pour l'historique).
    const hasDefault = await this.prisma.db.address.count({
      where: { userId, isDefault: true },
    });
    const shouldBeDefault = dto.isDefault === true || hasDefault === 0;

    return this.prisma.db.$transaction(async (tx) => {
      if (shouldBeDefault) {
        await tx.address.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.address.create({
        data: {
          userId,
          label: dto.label,
          city: dto.city,
          commune: dto.commune ?? null,
          district: dto.district ?? null,
          landmark: dto.landmark ?? null,
          instructions: dto.instructions ?? null,
          contactPhone: dto.contactPhone,
          latitude: dto.latitude ?? null,
          longitude: dto.longitude ?? null,
          isDefault: shouldBeDefault,
        },
        select: addressSelect,
      });
    });
  }

  async update(userId: string, id: string, dto: CreateAddressDto) {
    await this.assertOwned(userId, id);
    const shouldBeDefault = dto.isDefault === true;

    return this.prisma.db.$transaction(async (tx) => {
      if (shouldBeDefault) {
        await tx.address.updateMany({
          where: { userId, isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
      }

      return tx.address.update({
        where: { id },
        data: {
          label: dto.label,
          city: dto.city,
          commune: dto.commune ?? null,
          district: dto.district ?? null,
          landmark: dto.landmark ?? null,
          instructions: dto.instructions ?? null,
          contactPhone: dto.contactPhone,
          latitude: dto.latitude ?? null,
          longitude: dto.longitude ?? null,
          ...(shouldBeDefault ? { isDefault: true } : {}),
        },
        select: addressSelect,
      });
    });
  }

  async remove(userId: string, id: string) {
    const address = await this.assertOwned(userId, id);

    // Une adresse déjà utilisée par une commande ne peut pas disparaître :
    // l'historique doit rester lisible. On la retire simplement de la liste
    // en la déclassant.
    const usedByOrder = await this.prisma.db.order.count({
      where: { addressId: id },
    });

    if (usedByOrder > 0) {
      if (address.isDefault) {
        await this.prisma.db.address.update({
          where: { id },
          data: { isDefault: false },
        });
      }
      return { deleted: false as const, reason: 'USED_BY_ORDER' as const };
    }

    await this.prisma.db.address.delete({ where: { id } });

    // Si on vient de supprimer l'adresse par défaut, en promouvoir une autre.
    if (address.isDefault) {
      const next = await this.prisma.db.address.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (next) {
        await this.prisma.db.address.update({
          where: { id: next.id },
          data: { isDefault: true },
        });
      }
    }

    return { deleted: true as const };
  }

  /**
   * Vérifie que l'adresse appartient bien à l'utilisateur.
   * On renvoie NOT_FOUND et non FORBIDDEN : inutile de confirmer à un tiers
   * qu'un identifiant existe.
   */
  private async assertOwned(userId: string, id: string) {
    const address = await this.prisma.db.address.findFirst({
      where: { id, userId },
      select: { id: true, isDefault: true },
    });
    if (!address) {
      throw new NotFoundException({
        code: 'ADDRESS_NOT_FOUND',
        message: 'Cette adresse est introuvable.',
      });
    }
    return address;
  }
}
