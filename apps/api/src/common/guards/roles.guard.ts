import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { Role } from '@agrim/contracts';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * RBAC serveur. Le frontend n'est JAMAIS une couche de sécurité (section 22) :
 * Stack.Protected côté mobile ne protège que l'affichage.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const { user } = context
      .switchToHttp()
      .getRequest<{ user?: { role: Role } }>();

    if (!user || !required.includes(user.role)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN_ROLE',
        message: "Vous n'avez pas les droits nécessaires pour cette action.",
      });
    }
    return true;
  }
}
