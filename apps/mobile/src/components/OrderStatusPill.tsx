import { ORDER_STATUS_PRESENTATION, type OrderStatus } from '@agrim/contracts';

import { Pill, type PillTone } from '@/components/ui';

/**
 * Étiquette de statut de commande.
 *
 * Le libellé vient du contrat partagé ; seule la couleur est une décision
 * d'interface. Centralisé pour qu'un même statut ne soit jamais vert ici et
 * gris ailleurs.
 */

const TONES: Record<OrderStatus, PillTone> = {
  PENDING: 'gold',
  CONFIRMED: 'info',
  PREPARING: 'info',
  READY: 'info',
  OUT_FOR_DELIVERY: 'green',
  DELIVERED: 'green',
  CANCELLED: 'danger',
};

export function OrderStatusPill({ status }: { status: OrderStatus }) {
  return (
    <Pill
      label={ORDER_STATUS_PRESENTATION[status].label}
      tone={TONES[status]}
    />
  );
}
