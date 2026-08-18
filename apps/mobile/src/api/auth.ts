import { authTokensSchema, userSchema, type User } from '@agrim/contracts';
import { z } from 'zod';

import { apiRequest } from './client';

/**
 * Appels d'authentification.
 *
 * Aucun de ces appels ne stocke quoi que ce soit : la persistance des tokens
 * est la responsabilité du store d'auth, qui seul connaît SecureStore.
 */

export const authResponseSchema = authTokensSchema.extend({
  user: userSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

export type LoginPayload = { phone: string; password: string };

export type RegisterPayload = {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  password: string;
};

export function login(payload: LoginPayload): Promise<AuthResponse> {
  return apiRequest({
    method: 'POST',
    path: '/auth/login',
    body: payload,
    schema: authResponseSchema,
    isPublic: true,
  });
}

export function register(payload: RegisterPayload): Promise<AuthResponse> {
  return apiRequest({
    method: 'POST',
    path: '/auth/register',
    body: payload,
    schema: authResponseSchema,
    isPublic: true,
  });
}

/** Échange le refresh token contre une nouvelle paire (rotation côté serveur). */
export function refreshSession(refreshToken: string): Promise<AuthResponse> {
  return apiRequest({
    method: 'POST',
    path: '/auth/refresh',
    body: { refreshToken },
    schema: authResponseSchema,
    isPublic: true,
  });
}

export function logout(refreshToken: string): Promise<void> {
  return apiRequest({
    method: 'POST',
    path: '/auth/logout',
    body: { refreshToken },
    schema: z.undefined(),
    isPublic: true,
  }).then(() => undefined);
}

export function fetchMe(): Promise<User> {
  return apiRequest({ path: '/auth/me', schema: userSchema });
}
