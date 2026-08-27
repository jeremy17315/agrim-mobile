import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

import { NormalizePhone } from '../../common/transforms/normalize-phone';

export class ResetPasswordDto {
  @ApiProperty({ example: '0700000001' })
  @NormalizePhone()
  @Matches(/^(\+225)?\s?[0-9]{10}$/, { message: 'Numéro ivoirien invalide' })
  phone!: string;

  @ApiProperty({ example: '482917' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Le code comporte 6 chiffres.' })
  code!: string;

  @ApiProperty({ example: 'Nouveau2026!' })
  @IsString()
  @MinLength(8, { message: 'Au moins 8 caractères' })
  @MaxLength(200)
  @Matches(/[A-Za-z]/, { message: 'Doit contenir une lettre' })
  @Matches(/[0-9]/, { message: 'Doit contenir un chiffre' })
  password!: string;
}
