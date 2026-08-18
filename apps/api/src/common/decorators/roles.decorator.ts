import { SetMetadata } from '@nestjs/common';

import type { Role } from '@agrim/contracts';

export const ROLES_KEY = 'roles';

/** Restreint une route à certains rôles (RBAC vérifié côté serveur). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
