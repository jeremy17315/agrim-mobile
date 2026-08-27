import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { z } from 'zod';

import { apiRequest } from './client';
import { orderKeys } from './orders';

const initiateSchema = z.object({
  status: z.string(),
  checkoutUrl: z.string().nullable().optional(),
  message: z.string().optional(),
  reference: z.string(),
});
export type PaymentInitiate = z.infer<typeof initiateSchema>;

const statusSchema = z.object({
  id: z.uuid(),
  status: z.string(),
  method: z.string(),
  provider: z.string().nullable(),
  amount: z.number().int(),
  providerReference: z.string().nullable(),
  expiresAt: z.iso.datetime().nullable().optional(),
  paidAt: z.iso.datetime().nullable().optional(),
  failureReason: z.string().nullable(),
});

export function initiatePayment(reference: string): Promise<PaymentInitiate> {
  return apiRequest({
    method: 'POST',
    path: `/payments/orders/${reference}/initiate`,
    schema: initiateSchema,
  });
}

export function fetchPaymentStatus(reference: string, signal?: AbortSignal) {
  return apiRequest({
    path: `/payments/orders/${reference}`,
    schema: statusSchema,
    signal,
  });
}

export function useInitiatePayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: initiatePayment,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({
        queryKey: orderKeys.detail(result.reference),
      });
    },
    retry: false,
  });
}

/** Statuts depuis lesquels le paiement peut encore bouger tout seul. */
const PAYMENT_IN_FLIGHT = ['PENDING', 'AWAITING_CONFIRMATION'];

/**
 * Le paiement peut-il encore changer d'état sans action du client ?
 *
 * Sert à décider s'il faut continuer d'interroger le serveur, et à repérer la
 * bascule vers un état réglé — moment où la commande elle-même a changé de
 * statut et doit être relue.
 */
export function paiementEnSuspens(status: string): boolean {
  return PAYMENT_IN_FLIGHT.includes(status);
}

/** Cadence d'interrogation tant que le paiement n'est pas tranché. */
const PAYMENT_POLL_MS = 5_000;

/**
 * État du paiement d'une commande, rafraîchi tant qu'il reste en suspens.
 *
 * Le mobile money se valide HORS de l'application : le client part sur une
 * page d'opérateur ou compose un code USSD, puis revient. Sans interrogation
 * périodique, il retrouvait un écran figé sur « en attente » — alors que le
 * serveur, lui, savait déjà. Pire : c'est cette requête qui déclenche côté API
 * la vérification auprès du fournisseur et l'expiration des transactions
 * abandonnées.
 *
 * L'interrogation s'arrête d'elle-même dès que le paiement est tranché, ce qui
 * évite de consommer de la data sur un réseau facturé au mégaoctet.
 */
export function usePaymentStatus(reference: string, enabled = false) {
  return useQuery({
    queryKey: ['payments', reference],
    queryFn: ({ signal }) => fetchPaymentStatus(reference, signal),
    enabled: enabled && reference.length > 0,
    // Le `staleTime` global est d'une minute : adapté à un catalogue, bien trop
    // long pour un paiement que l'on suit à la seconde. Neutralisé ici seulement.
    staleTime: 0,
    refetchInterval: (query) =>
      PAYMENT_IN_FLIGHT.includes(query.state.data?.status ?? '')
        ? PAYMENT_POLL_MS
        : false,
  });
}

/**
 * Suit le paiement d'une commande et renvoie son statut courant.
 *
 * Encapsule DEUX choses que l'écran n'a pas à connaître : l'interrogation
 * périodique, et la relecture de la commande au moment où le paiement se
 * règle. Ce dernier point compte — quand le paiement aboutit, c'est la
 * COMMANDE qui change d'état côté serveur (confirmée ou annulée) ; sans
 * invalidation, l'écran afficherait « paiement confirmé » au-dessus d'une
 * commande restée « en attente ».
 *
 * L'invalidation n'a lieu qu'à la BASCULE « en suspens → réglé » : un paiement
 * déjà tranché à l'ouverture de l'écran ne justifie aucune relecture, la
 * commande vient d'être chargée.
 *
 * @param statutConnu statut porté par la commande déjà chargée, qui sert de
 *   valeur de départ et décide s'il y a lieu d'interroger le serveur.
 */
export function useSuiviPaiement(
  reference: string,
  statutConnu?: string | null,
): string | null {
  const queryClient = useQueryClient();
  const suivi = usePaymentStatus(
    reference,
    paiementEnSuspens(statutConnu ?? ''),
  );
  const statut = suivi.data?.status ?? statutConnu ?? null;

  const precedent = useRef<string | null>(null);
  useEffect(() => {
    const avant = precedent.current;
    precedent.current = statut;

    if (
      avant &&
      paiementEnSuspens(avant) &&
      statut &&
      !paiementEnSuspens(statut)
    ) {
      void queryClient.invalidateQueries({
        queryKey: orderKeys.detail(reference),
      });
    }
  }, [statut, queryClient, reference]);

  return statut;
}
