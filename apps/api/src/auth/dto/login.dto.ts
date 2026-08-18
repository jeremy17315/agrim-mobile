import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: '0700000001', description: 'Numéro ivoirien' })
  @Matches(/^(\+225)?\s?[0-9]{10}$/, { message: 'Numéro ivoirien invalide' })
  phone!: string;

  @ApiProperty({ example: 'Agrim2026!' })
  @IsString()
  @MinLength(1, { message: 'Mot de passe requis' })
  password!: string;
}
