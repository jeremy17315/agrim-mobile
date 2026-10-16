import { notificationSchema } from '@agrim/contracts';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { z } from 'zod';

import { apiRequest } from './client';

/**
 * Notifications de l'utilisateur connecté.
 *
 * Le serveur ne renvoie que les siennes : aucun filtre côté client n'est
 * nécessaire, et aucun identifiant d'utilisateur ne transite.
 */

const listSchema = z.object({
  data: z.array(notificationSchema),
  meta: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    unread: z.number().int(),
  }),
});
export type NotificationList = z.infer<typeof listSchema>;
export type NotificationItem = NotificationList['data'][number];

export const notificationKeys = {
  all: ['notifications'] as const,
  list: () => [...notificationKeys.all, 'list'] as const,
};

export function useNotifications(
  enabled = true,
): UseQueryResult<NotificationList> {
  return useQuery({
    queryKey: notificationKeys.list(),
    queryFn: () =>
      apiRequest({
        path: '/notifications',
        query: { limit: 50 },
        schema: listSchema,
      }),
    enabled,
    // Le compteur de non-lues doit rester crédible sans être coûteux : on
    // rafraîchit au retour sur l'écran plutôt qu'en boucle.
    staleTime: 30_000,
  });
}

/** Compteur de non-lues, dérivé de la même requête pour éviter un aller-retour. */
export function useUnreadCount(enabled = true): number {
  const query = useNotifications(enabled);
  return query.data?.meta.unread ?? 0;
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    // Sans identifiants, le serveur marque tout : c'est le geste courant.
    mutationFn: (ids?: string[]) =>
      apiRequest({
        path: '/notifications/read',
        method: 'PATCH',
        body: ids && ids.length > 0 ? { ids } : {},
        schema: z.object({ updated: z.number().int() }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

/* ------------------------------ Appareils -------------------------------- */

/**
 * Ces appels ne sont pas des hooks : ils sont déclenchés par le cycle de vie
 * de l'appareil (démarrage, connexion, déconnexion) et par la commande d'un
 * invité, jamais par le rendu.
 *
 * Les trois routes sont publiques ET acceptent la session : un invité
 * enregistre son appareil sans compte, et un client connecté voit le sien
 * rattaché à son compte — le compte est déduit du jeton de session par le
 * serveur, jamais envoyé dans le corps de la requête.
 */

export function registerPushDevice(input: {
  installationId: string;
  token: string;
  platform: 'ios' | 'android';
  phone?: string;
  promoOptIn?: boolean;
}) {
  return apiRequest({
    path: '/notifications/devices',
    method: 'POST',
    body: input,
    schema: z.object({ registered: z.boolean() }),
    isPublic: true,
    withOptionalAuth: true,
  });
}

/** Déconnexion : l'appareil reste actif, mais détaché du compte précédent. */
export function unlinkPushDevice(input: {
  installationId: string;
  token: string;
}) {
  return apiRequest({
    path: '/notifications/devices',
    method: 'DELETE',
    body: input,
    schema: z.object({ removed: z.boolean() }),
    isPublic: true,
    withOptionalAuth: true,
  });
}

/** Numéro d'un invité (pour le joindre) ou préférence promotions. */
export function updatePushDevice(input: {
  installationId: string;
  phone?: string;
  promoOptIn?: boolean;
}) {
  return apiRequest({
    path: '/notifications/devices',
    method: 'PATCH',
    body: input,
    schema: z.object({ updated: z.boolean() }),
    isPublic: true,
    withOptionalAuth: true,
  });
}
