/**
 * Le cul-de-sac corrigé, mis sous test.
 *
 * Quand un livreur trouvait porte close et clôturait sa course en `FAILED`, la
 * commande restait à `OUT_FOR_DELIVERY` — statut que ni le client, ni la
 * gestion, ni la clôture d'exception ne savent quitter. Elle était immobilisée
 * définitivement, son stock réservé avec elle.
 *
 * Quatre propriétés sont vérifiées ici, et chacune correspond à une décision
 * qui se prend mal si on ne l'écrit pas :
 *   1. la commande revient à `READY`, donc redevient actionnable ;
 *   2. le stock n'est PAS rendu — la commande vit encore, les sacs lui restent
 *      affectés ; il ne revient au rayon qu'à l'annulation ;
 *   3. le motif de l'échec survit dans le journal de la commande, seul endroit
 *      où l'historique des tentatives est conservé ;
 *   4. le client reçoit un message qui reconnaît l'échec, et non le « votre
 *      commande est prête » qu'entraînerait mécaniquement le retour à `READY`.
 */
import 'dotenv/config';

import { DeliveriesService } from './deliveries.service';
import type { DeliveryOtpService } from './delivery-otp.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';

const DELIVERY = { id: 'del-1', status: 'ARRIVED', orderId: 'order-1' };
const COURIER_ID = 'courier-1';

function makeHarness(orderStatus = 'OUT_FOR_DELIVERY') {
  const tx = {
    delivery: { update: jest.fn().mockResolvedValue({ id: DELIVERY.id }) },
    order: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ status: orderStatus }),
      update: jest.fn().mockResolvedValue({}),
    },
    orderEvent: { create: jest.fn().mockResolvedValue({}) },
    productVariant: { update: jest.fn().mockResolvedValue({}) },
  };

  const prisma = {
    db: {
      delivery: { findFirst: jest.fn().mockResolvedValue(DELIVERY) },
      order: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ userId: 'user-1', reference: 'AGR-2026-0001' }),
      },
      $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
    },
  } as unknown as PrismaService;

  const notifications = {
    notify: jest.fn().mockResolvedValue(undefined),
    notifyOrderStatus: jest.fn().mockResolvedValue(undefined),
  } as unknown as NotificationsService;

  const otp = { issue: jest.fn() } as unknown as DeliveryOtpService;

  const service = new DeliveriesService(prisma, notifications, otp);

  return { service, tx, notifications };
}

describe('Échec de livraison', () => {
  const dto = {
    status: 'FAILED' as const,
    failureReason: 'Porte close, client injoignable',
  };

  it('ramène la commande à READY au lieu de la laisser bloquée', async () => {
    const { service, tx } = makeHarness();

    await service.updateStatus(COURIER_ID, DELIVERY.id, dto);

    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: DELIVERY.orderId },
      data: { status: 'READY' },
    });
  });

  it('ne rend PAS le stock : la commande est encore vivante', async () => {
    // Distinction structurante du lot : le stock suit la VIE de la commande,
    // pas le sort d'une tentative. Le rendre ici, alors que la commande va
    // repartir, ferait vendre deux fois la même marchandise.
    const { service, tx } = makeHarness();

    await service.updateStatus(COURIER_ID, DELIVERY.id, dto);

    expect(tx.productVariant.update).not.toHaveBeenCalled();
  });

  it('conserve le motif dans le journal de la commande', async () => {
    const { service, tx } = makeHarness();

    await service.updateStatus(COURIER_ID, DELIVERY.id, dto);

    expect(tx.orderEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: DELIVERY.orderId,
        status: 'READY',
        comment: expect.stringContaining('Porte close'),
      }),
    });
  });

  it('annonce un échec au client, pas une commande prête', async () => {
    const { service, notifications } = makeHarness();

    await service.updateStatus(COURIER_ID, DELIVERY.id, dto);

    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'DELIVERY_FAILED' }),
    );
    // Le piège : `notifyOrderStatus('READY')` enverrait « Votre commande est
    // prête. Un livreur va la prendre en charge » à quelqu'un qui vient de
    // manquer sa livraison.
    expect(notifications.notifyOrderStatus).not.toHaveBeenCalled();
  });

  it("laisse tranquille une commande déjà annulée", async () => {
    const { service, tx } = makeHarness('CANCELLED');

    await service.updateStatus(COURIER_ID, DELIVERY.id, dto);

    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('exige un motif écrit', async () => {
    const { service } = makeHarness();

    await expect(
      service.updateStatus(COURIER_ID, DELIVERY.id, {
        status: 'FAILED',
        failureReason: '   ',
      }),
    ).rejects.toThrow();
  });
});
