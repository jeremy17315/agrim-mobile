import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** Identifiant d'installation : aléatoire, généré une fois sur l'appareil. */
export const INSTALLATION_ID_PATTERN = /^[A-Za-z0-9-]{16,64}$/;

/**
 * Enregistrement d'un appareil SANS compte (client invité).
 *
 * L'identifiant d'installation n'est jamais affiché : il sert de référence
 * secrète entre l'appareil et le serveur. Un tiers qui ne le connaît pas ne
 * peut ni relire ni réassigner cet appareil.
 */
export class RegisterDeviceDto {
  @ApiProperty({ example: '3f9a2c1e-8d4b-4c7a-9e21-6b0d5a7f1c33' })
  @IsString()
  @Matches(INSTALLATION_ID_PATTERN, { message: 'Identifiant d’installation invalide.' })
  installationId!: string;

  @ApiProperty({ example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' })
  @IsString()
  @MaxLength(200)
  @Matches(/^ExponentPushToken\[[^\]]+\]$/, { message: 'Jeton de notification invalide.' })
  token!: string;

  @ApiProperty({ enum: ['ios', 'android'] })
  @IsIn(['ios', 'android'])
  platform!: string;
}

export class PromoPreferenceDto {
  @ApiProperty()
  @IsString()
  @Matches(INSTALLATION_ID_PATTERN, { message: 'Identifiant d’installation invalide.' })
  installationId!: string;

  @ApiProperty({ description: 'Recevoir les promotions (réglage client).' })
  @IsBoolean()
  promoOptIn!: boolean;
}

/** Rattachement d'un appareil à un compte connecté (facultatif). */
export class DeviceLinkOptionsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(INSTALLATION_ID_PATTERN)
  installationId?: string;
}
