import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { NormalizePhone } from '../../common/transforms/normalize-phone';

export class RegisterDto {
  /**
   * Facultatif : le compte client se crée avec un numéro et un mot de passe.
   * Les deux champs restent acceptés pour les outils et les clients existants.
   */
  @ApiPropertyOptional({ example: 'Awa' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Koné' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  lastName?: string;

  @ApiProperty({ example: '0700000010' })
  @NormalizePhone()
  @Matches(/^(\+225)?\s?[0-9]{10}$/, { message: 'Numéro ivoirien invalide' })
  phone!: string;

  @ApiPropertyOptional({ example: 'awa.kone@example.ci' })
  @IsOptional()
  @IsEmail({}, { message: 'Email invalide' })
  email?: string;

  @ApiProperty({ example: 'Agrim2026!', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Au moins 8 caractères' })
  @Matches(/[A-Za-z]/, { message: 'Doit contenir une lettre' })
  @Matches(/[0-9]/, { message: 'Doit contenir un chiffre' })
  password!: string;

  @ApiPropertyOptional({ example: 'AB12CD' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{6}$/, { message: 'Code de parrainage invalide' })
  referralCode?: string;
}
