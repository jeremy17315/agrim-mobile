import {
  DELIVERY_STATUSES,
  TRACKING_CONFIG,
  deliveryOtpStatusSchema,
  type CourierSettableDeliveryStatus,
} from '@agrim/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { apiRequest } from './client';

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
  // Enum du contrat : une valeur ajoutée côté serveur ne doit pas exiger
  // d'édition ici.
  status: z.enum(DELIVERY_STATUSES),
  assignedAt: z.iso.datetime().nullable(),
  acceptedAt: z.iso.datetime().nullable(),
  inTransitAt: z.iso.datetime().nullable(),
  arrivedAt: z.iso.datetime().nullable(),
  deliveredAt: z.iso.datetime().nullable(),
  failureReason: z.string().nullable(),
  otpVerifiedAt: z.iso.datetime().nullable(),
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

export const deliveryKeys = {
  mine: ['deliveries', 'mine'] as const,
  detail: (id: string) => ['deliveries', id] as const,
  tracking: (reference: string) => ['tracking', reference] as const,
};

/* -------------------------------- Suivi GPS ------------------------------ */

const geoPointSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  accuracy: z.number().nullable(),
  heading: z.number().nullable(),
  speed: z.number().nullable(),
  recordedAt: z.iso.datetime(),
});

const trackingSchema = z.object({
  deliveryId: z.uuid(),
  orderReference: z.string(),
  status: z.string(),
  currentPosition: geoPointSchema.nullable(),
  destination: z.object({
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    landmark: z.string().nullable(),
  }),
  remainingMeters: z.number().int().nullable(),
  etaSeconds: z.number().int().nullable(),
  estimatedArrivalAt: z.iso.datetime().nullable(),
  lastUpdateAt: z.iso.datetime().nullable(),
  isLive: z.boolean(),
  courier: z
    .object({
      firstName: z.string(),
      contactPhone: z.string().nullable(),
      vehicleType: z.string().nullable(),
    })
    .nullable(),
});
export type DeliveryTracking = z.infer<typeof trackingSchema>;

/**
 * Suivi consommé par le client.
 *
 * L'interrogation périodique n'est active que tant que la position est
 * fraîche : inutile de solliciter le réseau et la batterie pour une course
 * terminée ou un livreur hors couverture.
 */
export function useDeliveryTracking(reference: string, enabled = true) {
  return useQuery({
    queryKey: deliveryKeys.tracking(reference),
    queryFn: () =>
      apiRequest({
        path: `/orders/${reference}/tracking`,
        schema: trackingSchema,
      }),
    enabled: enabled && reference.length > 0,
    refetchInterval: (query) =>
      query.state.data?.isLive === true
        ? TRACKING_CONFIG.clientPollSeconds * 1000
        : false,
    // Une erreur ici n'est pas bloquante : l'écran affiche « indisponible ».
    retry: 1,
  });
}

/** Envoi d'un lot de positions par le livreur. */
export function usePushLocations() {
  return useMutation({
    retry: false,
    mutationFn: (input: {
      deliveryId: string;
      points: {
        latitude: number;
        longitude: number;
        accuracy?: number;
        heading?: number;
        speed?: number;
        recordedAt: string;
      }[];
    }) =>
      apiRequest({
        path: '/deliveries/locations',
        method: 'POST',
        body: input,
        schema: z.object({
          accepted: z.number().int(),
          received: z.number().int(),
        }),
      }),
  });
}

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
    mutationFn: (input: {
      // Le type interdit dès la compilation de demander DELIVERED ou
      // OTP_VERIFIED : ces statuts n'appartiennent pas au terrain.
      status: CourierSettableDeliveryStatus;
      failureReason?: string;
    }) =>
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

/**
 * Validation de la livraison par le code du client.
 *
 * Le code n'est jamais connu de l'application livreur : il est dicté sur place
 * puis envoyé au serveur, seul juge. Une saisie erronée ne modifie rien.
 */
export function useVerifyOtp(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    retry: false,
    mutationFn: (input: {
      code: string;
      position?: { latitude: number; longitude: number };
    }) =>
      apiRequest({
        path: `/deliveries/${id}/verify-otp`,
        method: 'POST',
        body: input,
        schema: deliverySchema,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(deliveryKeys.detail(id), updated);
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.mine });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

/** État du code (actif, expiré, tentatives restantes) — jamais le code. */
export function useOtpStatus(id: string, enabled = true) {
  return useQuery({
    queryKey: [...deliveryKeys.detail(id), 'otp'],
    enabled: enabled && id.length > 0,
    queryFn: () =>
      apiRequest({
        path: `/deliveries/${id}/otp-status`,
        schema: deliveryOtpStatusSchema,
      }),
  });
}

/** Renvoi du code, à la demande du client depuis le suivi de sa commande. */
export function useResendOtp(reference: string) {
  return useMutation({
    retry: false,
    mutationFn: () =>
      apiRequest({
        path: `/deliveries/orders/${reference}/otp/resend`,
        method: 'POST',
        schema: deliveryOtpStatusSchema,
      }),
  });
}
