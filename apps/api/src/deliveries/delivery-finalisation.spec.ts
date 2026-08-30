/**
 * La fermeture de la réservation à la livraison, mise sous test.
 *
 * Le trou comblé
 * ──────────────
 * Une réservation `CONFIRMEE` reste LIBÉRABLE — c'est voulu : tant que la
 * marchandise n'est pas partie, une annulation doit rendre le stock. La remise
 * au client est le fait physique qui ferme cette porte, et c'est le seul
 * moment où on peut l'affirmer.
 *
 * Or aucun des deux chemins de livraison ne la fermait. Toute commande livrée
 * gardait une réservation ouverte côté site, et la seule protection était un
 * garde-fou d'un AUTRE module — `DELIVERED` n'appartient pas aux statuts
 * annulables de l'API. Une protection qui repose sur une coïncidence entre
 * deux modules n'est pas une protection : elle tombe à la première évolution.
 *
 * Ces tests gardent donc les trois propriétés qui comptent :
 *   1. une remise validée par code ferme la réservation ;
 *   2. une clôture d'exception la ferme aussi — une livraison n'est pas de
 *      moindre valeur parce qu'un gestionnaire l'a close ;
 *   3. un site injoignable n'empêche JAMAIS de clore une livraison réelle.
 *
 * Test unitaire : Prisma et le site sont simulés, il tourne sans PostgreSQL.
 */
import 'dotenv/config';

import { Logger } from '@nestjs/common';

import { DeliveriesService } from './deliveries.service';
import type { CatalogSyncService } from '../catalog-sync/catalog-sync.service';
import type { DeliveryOtpService } from './delivery-otp.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';

const COURIER_ID = 'courier-1';
const MANAGER_ID = 'manager-1';
/** Clé d'idempotence de la commande = clé de la réservation côté site. */
const CLE_RESERVATION = 'idem-key-1';

const COMMANDE = {
  id: 'order-1',
  userId: 'user-1',
  reference: 'AGR-2026-0001',
  idempotencyKey: CLE_RESERVATION,
};

/**
 * @param finalisation ce que le site répond — `unavailable` simule une panne.
 * @param cleReservation `null` pour une commande antérieure à la réservation.
 */
function makeHarness(
  finalisation: 'ok' | 'unavailable' = 'ok',
  cleReservation: string | null = CLE_RESERVATION,
) {
  const tx = {
    delivery: { update: jest.fn(async () => ({ id: 'del-1' })) },
    deliveryOtp: { updateMany: jest.fn(async () => ({ count: 0 })) },
    order: {
      findUniqueOrThrow: jest.fn(async () => ({ status: 'OUT_FOR_DELIVERY' })),
      update: jest.fn(async () => ({ userId: COMMANDE.userId })),
      count: jest.fn(async () => 1),
    },
    orderEvent: { create: jest.fn(async () => ({})) },
    // Parrainage : le filleul n'a pas de parrain, la branche s'arrête là.
    user: { findUnique: jest.fn(async () => ({ referredById: null })) },
  };

  const commande = { ...COMMANDE, idempotencyKey: cleReservation };

  const prisma = {
    db: {
      delivery: {
        findFirst: jest.fn(async () => ({
          id: 'del-1',
          status: 'ARRIVED',
          orderId: COMMANDE.id,
        })),
      },
      order: {
        findUnique: jest.fn(async () => ({
          ...commande,
          status: 'OUT_FOR_DELIVERY',
          delivery: { id: 'del-1', status: 'IN_TRANSIT' },
        })),
      },
      $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
    },
  } as unknown as PrismaService;

  const notifications = {
    notify: jest.fn(async () => undefined),
    notifyOrderStatus: jest.fn(async () => undefined),
  } as unknown as NotificationsService;

  const otp = {
    verify: jest.fn(async () => ({ otpId: 'otp-1' })),
  } as unknown as DeliveryOtpService;

  const catalog = {
    finaliseStock: jest.fn(async () =>
      finalisation === 'ok'
        ? { status: 'ok' as const, body: {} }
        : { status: 'unavailable' as const },
    ),
  } as unknown as CatalogSyncService;

  const service = new DeliveriesService(prisma, notifications, otp, catalog);

  return { service, tx, notifications, catalog, prisma };
}

describe('Fermeture de la réservation à la livraison', () => {
  let avertissements: jest.SpyInstance;

  beforeEach(() => {
    // On observe le journal : l'échec de finalisation doit laisser une trace,
    // c'est la seule façon de rattraper l'écart plus tard.
    avertissements = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('remise validée par le code du client', () => {
    it('ferme la réservation, avec la clé de la commande', async () => {
      const { service, catalog } = makeHarness();

      await service.verifyOtp(COURIER_ID, 'del-1', { code: '1234' });

      expect(catalog.finaliseStock).toHaveBeenCalledTimes(1);
      expect(catalog.finaliseStock).toHaveBeenCalledWith(CLE_RESERVATION);
    });

    it('ne rend AUCUN stock', async () => {
      // `finaliser` ferme la porte ; il ne déplace pas de marchandise. Le
      // stock a été retiré à la commande et il est parti chez le client.
      const { service, catalog } = makeHarness();

      await service.verifyOtp(COURIER_ID, 'del-1', { code: '1234' });

      expect(catalog.finaliseStock).toHaveBeenCalled();
      // Aucune libération : ce serait rendre au rayon ce qui est déjà livré.
      expect(
        (catalog as unknown as { releaseStock?: unknown }).releaseStock,
      ).toBeUndefined();
    });
  });

  describe('clôture d’exception par un gestionnaire', () => {
    it('ferme la réservation comme une remise ordinaire', async () => {
      // Une livraison close à la main reste une livraison : la marchandise
      // est chez le client. La traiter autrement laisserait une réservation
      // ouverte sur une commande bel et bien livrée.
      const { service, catalog } = makeHarness();

      await service.closeManually(
        MANAGER_ID,
        COMMANDE.reference,
        'Téléphone du client déchargé, remise en main propre',
      );

      expect(catalog.finaliseStock).toHaveBeenCalledTimes(1);
      expect(catalog.finaliseStock).toHaveBeenCalledWith(CLE_RESERVATION);
    });
  });

  describe('quand le site est injoignable', () => {
    it('livre quand même, et journalise l’écart', async () => {
      // LE point non négociable. La livraison est déjà écrite en base quand
      // on appelle le site : lever ici laisserait le livreur devant une
      // erreur pour une course pourtant terminée, qu'il rejouerait sans rien
      // réparer.
      const { service, catalog, notifications } = makeHarness('unavailable');

      await expect(
        service.verifyOtp(COURIER_ID, 'del-1', { code: '1234' }),
      ).resolves.toBeDefined();

      expect(catalog.finaliseStock).toHaveBeenCalled();
      // Le client est prévenu : la livraison a bien eu lieu pour lui.
      expect(notifications.notifyOrderStatus).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'DELIVERED' }),
      );
      // Et l'écart est traçable.
      expect(avertissements).toHaveBeenCalledWith(
        expect.stringContaining('non finalisée'),
      );
    });

    it('n’empêche pas non plus une clôture d’exception', async () => {
      const { service } = makeHarness('unavailable');

      await expect(
        service.closeManually(MANAGER_ID, COMMANDE.reference, 'Remise à un tiers'),
      ).resolves.toBeDefined();

      expect(avertissements).toHaveBeenCalledWith(
        expect.stringContaining('non finalisée'),
      );
    });
  });

  describe('commande antérieure à la réservation centralisée', () => {
    it('n’appelle pas le site quand il n’y a rien à finaliser', async () => {
      // Une commande sans clé de réservation n'a jamais réservé chez le site.
      // L'appeler produirait un aller-retour inutile et un avertissement
      // trompeur.
      const { service, catalog } = makeHarness('ok', null);

      await service.verifyOtp(COURIER_ID, 'del-1', { code: '1234' });

      expect(catalog.finaliseStock).not.toHaveBeenCalled();
      expect(avertissements).not.toHaveBeenCalledWith(
        expect.stringContaining('non finalisée'),
      );
    });
  });
});
