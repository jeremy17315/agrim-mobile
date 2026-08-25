import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

import { NormalizePhone } from '../../common/transforms/normalize-phone';

export class ForgotPasswordDto {
  @ApiProperty({ example: '0700000001' })
  @NormalizePhone()
  @Matches(/^(\+225)?\s?[0-9]{10}$/, { message: 'Numéro ivoirien invalide' })
  phone!: string;
}
