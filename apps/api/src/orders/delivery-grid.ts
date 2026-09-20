import { ServiceUnavailableException } from '@nestjs/common';
import type { DeliveryGrid } from '@agrim/contracts';

/**
 * Lecture de la grille officielle de livraison — partagée par le checkout
 * ET le devis panier : deux chemins qui liraient deux grilles produiraient
 * deux tarifs, et un devis qui ne serait pas celui facturé.
 *
 * On ne devine JAMAIS un tarif : grille absente ou illisible ⇒ refus (503),
 * jamais un forfait inventé.
 */
export const DELIVERY_GRID_KEY = 'deliveryGrid';

/** Source minimale : une transaction Prisma ou le service Prisma. */
type SourceGrille = {
  companySetting: {
    findUnique(args: {
      where: { key: string };
      select: { value: true };
    }): Promise<{ value: string } | null>;
  };
};

export async function readDeliveryGrid(source: SourceGrille): Promise<DeliveryGrid> {
  const setting = await source.companySetting.findUnique({
    where: { key: DELIVERY_GRID_KEY },
    select: { value: true },
  });
  if (!setting) {
    throw new ServiceUnavailableException({
      code: 'DELIVERY_GRID_UNAVAILABLE',
      message:
        'Les frais de livraison sont momentanément indisponibles. Réessayez dans un instant.',
    });
  }
  try {
    const grid = JSON.parse(setting.value) as DeliveryGrid;
    // Validation minimale de forme : une grille corrompue ne doit pas
    // produire un montant plausible mais faux.
    if (!grid.zones || typeof grid.zoneParDefaut !== 'string') {
      throw new Error('forme inattendue');
    }
    return grid;
  } catch {
    throw new ServiceUnavailableException({
      code: 'DELIVERY_GRID_UNAVAILABLE',
      message:
        'Les frais de livraison sont momentanément indisponibles. Réessayez dans un instant.',
    });
  }
}
