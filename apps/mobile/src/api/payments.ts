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

const guestPaymentHeaders = (token: string) => ({
  'X-Guest-Payment-Token': token,
});

/** Même initiation que le site, mais derrière une capacité temporaire plutôt
 * qu'un compte ou un JWT : le client invité reste un invité. */
export function initiateGuestPayment(
  reference: string,
  token: string,
): Promise<PaymentInitiate> {
  return apiRequest({
    method: 'POST',
    path: `/payments/guest/orders/${reference}/initiate`,
    schema: initiateSchema,
    isPublic: true,
    headers: guestPaymentHeaders(token),
  });
}

export function fetchPaymentStatus(reference: string, signal?: AbortSignal) {
  return apiRequest({
    path: `/payments/orders/${reference}`,
    schema: statusSchema,
    signal,
  });
}

export function fetchGuestPaymentStatus(
  reference: string,
  token: string,
  signal?: AbortSignal,
) {
  return apiRequest({
    path: `/payments/guest/orders/${reference}`,
    schema: statusSchema,
    isPublic: true,
    headers: guestPaymentHeaders(token),
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

export function useInitiateGuestPayment() {
  return useMutation({
    mutationFn: ({ reference, token }: { reference: string; token: string }) =>
      initiateGuestPayment(reference, token),
    retry: false,
  });
}

/**
 * Statuts depuis lesquels le paiement peut encore bouger sans action du client.
 *
 * `DECLARED_BY_CUSTOMER` et `UNDER_REVIEW` appartiennent au régime du transfert
 * direct : le client a déclaré, AGRIM vérifie — l'écran doit continuer à
 * interroger le serveur pour annoncer la confirmation dès qu'elle tombe.
 */
const PAYMENT_IN_FLIGHT = [
  'PENDING',
  'AWAITING_CONFIRMATION',
  'DECLARED_BY_CUSTOMER',
  'UNDER_REVIEW',
];

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

/** Suivi du même paiement pour un invité, autorisé par sa capacité temporaire. */
export function useGuestPaymentStatus(reference: string, token: string | null) {
  return useQuery({
    queryKey: ['guest-payment', reference],
    queryFn: ({ signal }) => fetchGuestPaymentStatus(reference, token!, signal),
    enabled: reference.length > 0 && token !== null,
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

/* ───────────────────── Paiement direct manuel (AGRIM) ───────────────────── */

/**
 * Un moyen de paiement ACTIF, tel qu'AGRIM l'a configuré.
 *
 * `receivingNumber` est le numéro officiel de réception : il est public par
 * nécessité (le client doit le composer), et il vient TOUJOURS du serveur —
 * jamais d'une constante du bundle.
 */
const directMethodSchema = z.object({
  code: z.string(),
  operatorName: z.string(),
  receivingNumber: z.string(),
  beneficiaryName: z.string().nullable(),
  instructions: z.string().nullable(),
  ussdTemplate: z.string().nullable(),
  /**
   * Contenu du QR marchand publié par AGRIM — le MÊME texte que le QR de
   * l'opérateur. `default(null)` : un serveur plus ancien qui ne le publie pas
   * encore n'empêche pas l'écran de s'afficher, il n'y a simplement pas de QR.
   */
  qrPayload: z.string().max(1000).nullable().default(null),
  /**
   * Lien de paiement de l'opérateur : c'est lui qui permet de payer AVEC CE
   * TÉLÉPHONE (un QR affiché à l'écran ne peut pas être scanné par ce même
   * téléphone). `default(null)` : un serveur plus ancien n'empêche rien.
   */
  paymentUrl: z.string().max(500).nullable().default(null),
});
export type DirectPaymentMethod = z.infer<typeof directMethodSchema>;

const paymentMethodsSchema = z.object({
  methods: z.array(directMethodSchema),
});

export function fetchPaymentMethods(signal?: AbortSignal) {
  return apiRequest({
    path: '/payments/methods',
    schema: paymentMethodsSchema,
    isPublic: true,
    signal,
  });
}

/**
 * Liste des moyens publiés par AGRIM. Rechargée régulièrement : un numéro
 * corrigé dans l'administration doit apparaître sans réinstaller l'application.
 */
export function usePaymentMethods() {
  return useQuery({
    queryKey: ['payments', 'methods'],
    queryFn: ({ signal }) => fetchPaymentMethods(signal),
    staleTime: 5 * 60_000,
  });
}

const paymentInstructionSchema = z.object({
  reference: z.string(),
  amount: z.number().int(),
  currency: z.literal('XOF'),
  status: z.string(),
  method: directMethodSchema,
  paymentReference: z.string(),
  declarations: z.number().int(),
  lastDeclaration: z
    .object({
      transactionReference: z.string(),
      declaredAmount: z.number().int(),
      submittedAt: z.iso.datetime(),
      status: z.string(),
    })
    .nullable(),
  /** Motif du dernier rejet : affiché au client, jamais tronqué en silence. */
  rejectionNote: z.string().nullable(),
});
export type PaymentInstruction = z.infer<typeof paymentInstructionSchema>;

/**
 * Instruction de paiement d'UNE commande.
 *
 * Le serveur vérifie le propriétaire : jeton de compte, ou capacité temporaire
 * pour une commande invitée. Le téléphone ne calcule rien — il affiche.
 */
export function fetchPaymentInstructions(
  reference: string,
  token: string | null,
  signal?: AbortSignal,
) {
  return apiRequest({
    path: token
      ? `/payments/guest/orders/${reference}/instructions`
      : `/payments/orders/${reference}/instructions`,
    schema: paymentInstructionSchema,
    isPublic: token !== null,
    headers: token ? guestPaymentHeaders(token) : undefined,
    signal,
  });
}

export function usePaymentInstructions(
  reference: string,
  token: string | null,
) {
  return useQuery({
    queryKey: ['payment-instructions', reference, token],
    queryFn: ({ signal }) => fetchPaymentInstructions(reference, token, signal),
    enabled: reference.length > 0 && token !== null,
    staleTime: 30_000,
  });
}

const declareResultSchema = z.object({
  recorded: z.boolean(),
  status: z.string(),
  amountMatches: z.boolean(),
  message: z.string(),
});
export type DeclareResult = z.infer<typeof declareResultSchema>;

export function declarePayment(input: {
  reference: string;
  token: string | null;
  transactionReference: string;
  declaredAmount: number;
  note?: string;
  paidAt?: string;
}): Promise<DeclareResult> {
  const { reference, token, ...body } = input;
  return apiRequest({
    method: 'POST',
    path: token
      ? `/payments/guest/orders/${reference}/declare`
      : `/payments/orders/${reference}/declare`,
    body,
    schema: declareResultSchema,
    isPublic: token !== null,
    headers: token ? guestPaymentHeaders(token) : undefined,
  });
}

/**
 * Déclaration d'un transfert effectué.
 *
 * Rien n'est confirmé ici : la réponse dit seulement que la déclaration est
 * ENREGISTRÉE, et le statut réel reste lu sur le serveur. Une référence déjà
 * utilisée (envoi rejoué, ou tentative de double validation) est refusée.
 */
export function useDeclarePayment(reference: string, token: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      transactionReference: string;
      declaredAmount: number;
      note?: string;
      paidAt?: string;
    }) => declarePayment({ reference, token, ...input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['payment-instructions', reference, token],
      });
      void queryClient.invalidateQueries({
        queryKey: token ? ['guest-payment', reference] : ['payments', reference],
      });
    },
    retry: false,
  });
}
