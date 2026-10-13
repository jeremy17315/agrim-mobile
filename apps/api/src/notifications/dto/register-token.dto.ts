import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

import { INSTALLATION_ID_PATTERN } from './register-device.dto';

export class RegisterTokenDto {
  @ApiProperty({ example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' })
  @IsString()
  @MaxLength(200)
  // Format Expo : rejeter tôt évite de stocker des jetons inexploitables.
  @Matches(/^ExponentPushToken\[[^\]]+\]$/, {
    message: 'Jeton de notification invalide.',
  })
  token!: string;

  @ApiProperty({ enum: ['ios', 'android'] })
  @IsIn(['ios', 'android'])
  platform!: string;

  /** Identifiant d'installation : lie l'appareil au compte à la connexion. */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Matches(INSTALLATION_ID_PATTERN)
  installationId?: string;
}
