import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { Role } from '@agrim/contracts';

export interface AuthenticatedUser {
  id: string;
  phone: string;
  role: Role;
}

/** Injecte l'utilisateur issu du JWT validé. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser =>
    ctx.switchToHttp().getRequest<{ user: AuthenticatedUser }>().user,
);

/**
 * Injecte l'utilisateur S'IL Y EN A UN — sinon `null`.
 *
 * Pour les routes publiques qui offrent un avantage réservé aux comptes : le
 * devis et la commande invitée appliquent le crédit de parrainage du compte
 * connecté. À utiliser avec `OptionalJwtAuthGuard`, qui pose `req.user`.
 */
export const OptionalUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | null =>
    ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser | null }>().user ??
    null,
);
