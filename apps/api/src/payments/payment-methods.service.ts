import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { DirectPaymentMethod } from '@agrim/contracts';

import { PrismaService } from '../prisma/prisma.service';
import type { UpsertPaymentMethodDto } from './dto/direct-payment.dto';
import { resolveOrderPaymentMethod } from './resolve-method';

/**
 * Moyens de paiement directs — la configuration d'AGRIM.
 *
 * ⚠️ C'est ICI que vivent les numéros de réception. Ils ne sont nuls partout
 * ailleurs : ni dans le bundle mobile, ni dans un fichier de code, ni dans la
 * documentation du dépôt. Les corriger prend effet immédiatement, sans
 * nouvelle version sur le Play Store.
 *
 * Aucun moyen n'est créé d'avance : un numéro de réception inventé enverrait
 * l'argent des clients à un inconnu. Tant qu'AGRIM n'a rien configuré,
 * `listActive()` renvoie une liste vide et l'application propose le paiement à
 * la livraison — elle n'affiche jamais un numéro qu'elle ne connaît pas.
 */
@Injectable()
export class PaymentMethodsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Ce que le client peut utiliser MAINTENANT. Liste vide = rien de configuré. */
  async listActive(): Promise<DirectPaymentMethod[]> {
    const methods = await this.prisma.db.paymentMethodConfig.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { operatorName: 'asc' }],
      select: {
        code: true,
        operatorName: true,
        receivingNumber: true,
        beneficiaryName: true,
        instructions: true,
        ussdTemplate: true,
        qrPayload: true,
        paymentUrl: true,
      },
    });
    return methods;
  }

  /** Vue complète pour l'administration (y compris les moyens désactivés). */
  async listAll() {
    return this.prisma.db.paymentMethodConfig.findMany({
      orderBy: [{ sortOrder: 'asc' }, { operatorName: 'asc' }],
      select: {
        id: true,
        code: true,
        operatorName: true,
        receivingNumber: true,
        beneficiaryName: true,
        instructions: true,
        ussdTemplate: true,
        qrPayload: true,
        paymentUrl: true,
        isActive: true,
        sortOrder: true,
        updatedAt: true,
        updatedBy: { select: { firstName: true, lastName: true } },
      },
    });
  }

  /**
   * Résolution au moment de la commande.
   *
   * Un code inconnu ou désactivé est REFUSÉ : encaisser vers un moyen que
   * l'administration a retiré enverrait le client payer sur un numéro qui
   * n'est plus suivi.
   */
  async resolveActiveOrFail(code: string) {
    // Règle UNIQUE, partagée avec la création de commande
    // (`payments/resolve-method.ts`) : deux implémentations de « ce moyen
    // existe-t-il ? » finiraient par diverger, et une commande pourrait naître
    // sur un moyen que l'administration vient de retirer.
    return resolveOrderPaymentMethod(this.prisma.db, code);
  }

  /** Création ou mise à jour — l'identité de l'auteur est conservée. */
  async upsert(dto: UpsertPaymentMethodDto, actorId: string) {
    const code = dto.code.trim().toUpperCase();
    if (!/^[A-Z0-9_]{2,40}$/.test(code)) {
      throw new BadRequestException({
        code: 'PAYMENT_METHOD_CODE_INVALID',
        message:
          'Le code technique ne peut contenir que des majuscules, chiffres et « _ ».',
      });
    }

    const existing = await this.prisma.db.paymentMethodConfig.findUnique({
      where: { code },
      select: { id: true },
    });

    // Le numéro est nettoyé des espaces et points de mise en forme : il doit
    // pouvoir être composé tel quel, et comparé d'une configuration à l'autre.
    const receivingNumber = normalizeNumber(dto.receivingNumber);

    if (existing) {
      await this.prisma.db.paymentMethodConfig.update({
        where: { id: existing.id },
        data: {
          operatorName: dto.operatorName.trim(),
          receivingNumber,
          beneficiaryName: dto.beneficiaryName?.trim() || null,
          instructions: dto.instructions?.trim() || null,
          ussdTemplate: dto.ussdTemplate?.trim() || null,
          ...(dto.qrPayload !== undefined
            ? { qrPayload: dto.qrPayload.trim() || null }
            : {}),
          ...(dto.paymentUrl !== undefined
            ? { paymentUrl: dto.paymentUrl.trim() || null }
            : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          updatedById: actorId,
        },
      });
    } else {
      await this.prisma.db.paymentMethodConfig.create({
        data: {
          code,
          operatorName: dto.operatorName.trim(),
          receivingNumber,
          beneficiaryName: dto.beneficiaryName?.trim() || null,
          instructions: dto.instructions?.trim() || null,
          ussdTemplate: dto.ussdTemplate?.trim() || null,
          qrPayload: dto.qrPayload?.trim() || null,
          paymentUrl: dto.paymentUrl?.trim() || null,
          // Un moyen créé sans indication explicite est INACTIF : le publier
          // par défaut l'exposerait aux clients avant relecture.
          isActive: dto.isActive ?? false,
          sortOrder: dto.sortOrder ?? 0,
          updatedById: actorId,
        },
      });
    }

    return this.listAll();
  }

  /** Désactivation (le moyen n'est jamais supprimé : l'historique y renvoie). */
  async deactivate(id: string, actorId: string) {
    const existing = await this.prisma.db.paymentMethodConfig.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'PAYMENT_METHOD_NOT_FOUND',
        message: 'Ce moyen de paiement est introuvable.',
      });
    }
    await this.prisma.db.paymentMethodConfig.update({
      where: { id },
      data: { isActive: false, updatedById: actorId },
    });
    return this.listAll();
  }
}

/** `07 00 05 04 52` → `0700050452` : composable et comparable. */
function normalizeNumber(value: string): string {
  return value.replace(/[\s.\-()]/g, '');
}
