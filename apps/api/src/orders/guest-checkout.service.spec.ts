jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));
jest.mock('./orders.service', () => ({
  OrdersService: class OrdersService {},
}));

import { BadRequestException } from '@nestjs/common';

import { GuestCheckoutService } from './guest-checkout.service';
import type { GuestPaymentTokenService } from './guest-payment-token.service';
import type { OrdersService } from './orders.service';
import type { PrismaService } from '../prisma/prisma.service';

const validDto = {
  customerName: '  Awa   Kouassi ',
  phone: '+225 07 00 05 04 52',
  deliveryLocation: '  Cocody, Riviera 3 — près du rond-point  ',
  items: [{ variantId: 'variant-1', quantity: 2 }],
  idempotencyKey: '7bd7f7f8-0d1f-41d2-9b4b-38ea183bd82d',
};

function makeHarness() {
  const guest = { id: 'guest-1' };
  const address = { id: 'address-1' };
  const created = { id: 'order-1', reference: 'AGR-2026-0001' };
  const prisma = {
    db: {
      user: {
        create: jest.fn().mockResolvedValue(guest),
        delete: jest.fn().mockResolvedValue(undefined),
      },
      address: { create: jest.fn().mockResolvedValue(address) },
      order: { findUnique: jest.fn().mockResolvedValue({ userId: guest.id }) },
    },
  } as unknown as PrismaService;
  const orders = {
    findGuestReplay: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue(created),
  } as unknown as OrdersService;
  const paymentTokens = {
    issue: jest.fn().mockReturnValue('guest-payment-capability'),
  } as unknown as GuestPaymentTokenService;

  return {
    service: new GuestCheckoutService(prisma, orders, paymentTokens),
    prisma,
    orders,
    paymentTokens,
    guest,
    address,
    created,
  };
}

describe('GuestCheckoutService', () => {
  it('crée uniquement les relations techniques et fige les coordonnées sur la commande', async () => {
    const { service, prisma, orders, guest, address, created } = makeHarness();

    await expect(service.create(validDto)).resolves.toEqual(created);

    expect(orders.findGuestReplay).toHaveBeenCalledWith(
      validDto.idempotencyKey,
      '+2250700050452',
    );
    expect(prisma.db.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          firstName: 'Client',
          lastName: 'invité',
          role: 'CLIENT',
          isGuest: true,
          phone: expect.stringMatching(/^guest-/),
        }),
        select: { id: true },
      }),
    );
    expect(prisma.db.address.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: guest.id,
        city: 'Cocody, Riviera 3 — près du rond-point',
        landmark: 'Cocody, Riviera 3 — près du rond-point',
        contactPhone: '+2250700050452',
      }),
      select: { id: true },
    });
    expect(orders.create).toHaveBeenCalledWith(
      guest.id,
      expect.objectContaining({
        addressId: address.id,
        items: validDto.items,
        paymentMethod: 'CASH_ON_DELIVERY',
        idempotencyKey: validDto.idempotencyKey,
      }),
      {
        name: 'Awa Kouassi',
        phone: '+2250700050452',
        deliveryLocation: 'Cocody, Riviera 3 — près du rond-point',
      },
    );
  });

  it('prépare le même paiement Mobile Money que le site sans créer de compte', async () => {
    const { service, orders, paymentTokens } = makeHarness();
    (orders.create as jest.Mock).mockResolvedValueOnce({
      id: 'order-1',
      reference: 'AGR-2026-0001',
      payment: { method: 'MOBILE_MONEY' },
    });

    await expect(
      service.create({
        ...validDto,
        paymentMethod: 'MOBILE_MONEY',
        mobileMoneyProvider: 'ORANGE_MONEY',
      }),
    ).resolves.toMatchObject({
      reference: 'AGR-2026-0001',
      paymentAccessToken: 'guest-payment-capability',
    });

    expect(orders.create).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        paymentMethod: 'MOBILE_MONEY',
        mobileMoneyProvider: 'ORANGE_MONEY',
      }),
      expect.any(Object),
    );
    expect(paymentTokens.issue).toHaveBeenCalledWith('AGR-2026-0001');
  });

  it('renvoie un rejeu existant sans créer de profil invité supplémentaire', async () => {
    const { service, prisma, orders, created } = makeHarness();
    (orders.findGuestReplay as jest.Mock).mockResolvedValueOnce(created);

    await expect(service.create(validDto)).resolves.toEqual(created);

    expect(prisma.db.user.create).not.toHaveBeenCalled();
    expect(prisma.db.address.create).not.toHaveBeenCalled();
    expect(orders.create).not.toHaveBeenCalled();
  });

  it('refuse un téléphone invalide avant toute écriture', async () => {
    const { service, prisma, orders } = makeHarness();

    await expect(
      service.create({ ...validDto, phone: 'ce n’est pas un téléphone' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(orders.findGuestReplay).not.toHaveBeenCalled();
    expect(prisma.db.user.create).not.toHaveBeenCalled();
  });
});
