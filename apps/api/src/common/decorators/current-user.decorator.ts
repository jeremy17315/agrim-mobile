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
