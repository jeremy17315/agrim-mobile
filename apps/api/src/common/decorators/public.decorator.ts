import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marque une route accessible sans JWT (login, catalogue public…). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
