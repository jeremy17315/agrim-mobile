import {
  DELIVERY_PROOF_METHODS,
  type DeliveryProofMethod,
  type DeliveryStatus,
} from '@agrim/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { API_BASE_URL, apiRequest, currentAccessToken } from './client';

/**
 * Espace livreur.
 *
 * Le mobile ne décide de rien : il demande une transition, le serveur
 * l'accepte ou la refuse selon la machine à états. Aucune règle métier n'est
 * dupliquée ici.
 */

const deliveryItemSchema = z.object({
  id: z.uuid(),
  productName: z.string(),
  variantLabel: z.string(),
  quantity: z.number().int(),
});

const deliveryAddressSchema = z.object({
  label: z.string(),
  city: z.string(),
  commune: z.string().nullable(),
  district: z.string().nullable(),
  landmark: z.string().nullable(),
  instructions: z.string().nullable(),
  contactPhone: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
});

const deliverySchema = z.object({
  id: z.uuid(),
  status: z.enum([
    'UNASSIGNED',
    'ASSIGNED',
    'ACCEPTED',
    'PICKED_UP',
    'IN_TRANSIT',
    'DELIVERED',
    'FAILED',
  ]),
  assignedAt: z.iso.datetime().nullable(),
  acceptedAt: z.iso.datetime().nullable(),
  pickedUpAt: z.iso.datetime().nullable(),
  deliveredAt: z.iso.datetime().nullable(),
  failureReason: z.string().nullable(),
  proofMethods: z.array(z.enum(DELIVERY_PROOF_METHODS)),
  proofReceivedBy: z.string().nullable(),
  proofSubmittedAt: z.iso.datetime().nullable(),
  order: z.object({
    reference: z.string(),
    total: z.number().int(),
    status: z.string(),
    items: z.array(deliveryItemSchema),
    payment: z.object({ method: z.string(), status: z.string() }).nullable(),
  }),
  address: deliveryAddressSchema,
});
export type Delivery = z.infer<typeof deliverySchema>;

const deliveriesSchema = z.array(deliverySchema);

const uploadedFileSchema = z.object({
  id: z.uuid(),
  url: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
});

export const deliveryKeys = {
  mine: ['deliveries', 'mine'] as const,
  detail: (id: string) => ['deliveries', id] as const,
};

/** Tournée du livreur. */
export function useMyDeliveries(includeDone = false) {
  return useQuery({
    queryKey: [...deliveryKeys.mine, includeDone],
    queryFn: () =>
      apiRequest({
        path: `/deliveries/mine?includeDone=${includeDone}`,
        schema: deliveriesSchema,
      }),
  });
}

export function useDelivery(id: string) {
  return useQuery({
    queryKey: deliveryKeys.detail(id),
    queryFn: () =>
      apiRequest({ path: `/deliveries/${id}`, schema: deliverySchema }),
    enabled: id.length > 0,
  });
}

/** Fait avancer la course. Le serveur valide la transition. */
export function useUpdateDeliveryStatus(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    retry: false,
    mutationFn: (input: { status: DeliveryStatus; failureReason?: string }) =>
      apiRequest({
        path: `/deliveries/${id}/status`,
        method: 'PATCH',
        body: input,
        schema: deliverySchema,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(deliveryKeys.detail(id), updated);
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.mine });
      // Le client suit sa commande : son historique n'est plus à jour.
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

export type SubmitProofInput = {
  methods: DeliveryProofMethod[];
  signatureFileId?: string;
  photoFileId?: string;
  receivedBy?: string;
  note?: string;
  position?: { latitude: number; longitude: number };
};

export function useSubmitProof(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    retry: false,
    mutationFn: (input: SubmitProofInput) =>
      apiRequest({
        path: `/deliveries/${id}/proof`,
        method: 'POST',
        body: input,
        schema: deliverySchema,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(deliveryKeys.detail(id), updated);
    },
  });
}

/**
 * Dépôt d'un fichier de preuve.
 *
 * `apiRequest` sérialise en JSON : un envoi multipart passe donc par `fetch`
 * directement, en réutilisant le jeton et l'URL de base de la couche API.
 * Le `Content-Type` est laissé à la plateforme, qui doit y placer la frontière
 * multipart — le forcer casserait l'envoi.
 */
export async function uploadProofFile(file: {
  uri: string;
  name: string;
  type: string;
}) {
  const form = new FormData();
  // La forme { uri, name, type } est celle attendue par React Native.
  form.append('file', file as unknown as Blob);

  const token = currentAccessToken();
  const response = await fetch(`${API_BASE_URL}/files/proofs`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload as { code?: string; message?: string } | null;
    throw new Error(detail?.message ?? 'Le dépôt du fichier a échoué.');
  }

  return uploadedFileSchema.parse(payload);
}
