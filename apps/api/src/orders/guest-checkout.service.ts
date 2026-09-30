import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable } from '@nestjs/common';
import { phoneSchema } from '@agrim/contracts';

import { PrismaService } from '../prisma/prisma.service';
import type { CreateOrderDto } from './dto/create-order.dto';
import type { CreateGuestOrderDto } from './dto/create-guest-order.dto';
import { OrdersService } from './orders.service';

/**
 * Checkout public.
 *
 * Les relations historiques de livraison, paiement et stock attendent un
 * `User` et une `Address`. On crée donc un profil TECHNIQUE par commande,
 * impossible à utiliser pour se connecter, tout en figeant le vrai nom et le
 * vrai téléphone directement sur la commande. Le client n'a ni mot de passe,
 * ni compte à retrouver, ni écran de connexion.
 */
@Injectable()
export class GuestCheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
  ) {}

  async create(dto: CreateGuestOrderDto) {
    const customerName = dto.customerName.trim().replace(/\s+/g, ' ');
    const deliveryLocation = dto.deliveryLocation.trim().replace(/\s+/g, ' ');
    const phoneResult = phoneSchema.safeParse(dto.phone);
    if (!phoneResult.success) {
      throw new BadRequestException({
        code: 'INVALID_PHONE',
        message: 'Numéro ivoirien invalide.',
      });
    }
    const phone = phoneResult.data;

    // Réponse perdue ou double-tap : aucun nouveau profil, aucun nouveau stock.
    const replay = await this.orders.findGuestReplay(dto.idempotencyKey, phone);
    if (replay) return replay;

    const seed = randomUUID().replace(/-/g, '').toUpperCase();
    const guest = await this.prisma.db.user.create({
      data: {
        // Ces valeurs ne sont jamais affichées : le personnel lit guestName et
        // guestPhone, figés sur Order. Elles satisfont uniquement les relations
        // existantes sans détournement d'un vrai compte client.
        firstName: 'Client',
        lastName: 'invité',
        phone: `guest-${seed.slice(0, 14)}`,
        passwordHash: `guest:${randomUUID()}`,
        referralCode: `G${seed.slice(0, 11)}`,
        role: 'CLIENT',
        isGuest: true,
      },
      select: { id: true },
    });

    try {
      const address = await this.prisma.db.address.create({
        data: {
          userId: guest.id,
          label: 'Livraison invité',
          // La grille existante rapproche ce texte de ses zones connues ; une
          // zone libre non reconnue reçoit le tarif par défaut, jamais un prix
          // inventé par le mobile.
          city: deliveryLocation.slice(0, 80),
          landmark: deliveryLocation,
          contactPhone: phone,
          isDefault: true,
        },
        select: { id: true },
      });

      const order: CreateOrderDto = {
        addressId: address.id,
        items: dto.items,
        paymentMethod: 'CASH_ON_DELIVERY',
        idempotencyKey: dto.idempotencyKey,
      };
      const created = await this.orders.create(guest.id, order, {
        name: customerName,
        phone,
        deliveryLocation,
      });

      // Deux taps simultanés peuvent partager la même idempotencyKey. Le
      // second reçoit la première commande, mais son profil technique ne porte
      // aucune livraison : on le retire immédiatement.
      const owner = await this.prisma.db.order.findUnique({
        where: { id: created.id },
        select: { userId: true },
      });
      if (owner?.userId !== guest.id) {
        await this.prisma.db.user.delete({ where: { id: guest.id } });
      }

      return created;
    } catch (error) {
      // Si rien n'a été créé, ne gardons pas un profil technique orphelin.
      // Si une course d'idempotence a finalement créé la commande, le profil
      // est conservé car il porte alors l'adresse de la livraison.
      const created = await this.prisma.db.order.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
        select: { id: true },
      });
      if (!created) {
        await this.prisma.db.user
          .delete({ where: { id: guest.id } })
          .catch(() => undefined);
      }
      throw error;
    }
  }
}
