import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

export function usePaymentStatus(reference: string, enabled = false) {
  return useQuery({
    queryKey: ['payments', reference],
    queryFn: ({ signal }) => fetchPaymentStatus(reference, signal),
    enabled: enabled && reference.length > 0,
  });
}
