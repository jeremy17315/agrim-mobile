import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import { NormalizePhone } from '../../common/transforms/normalize-phone';

/**
 * Enregistrement d'un APPAREIL (et non d'un compte).
 *
 * C'est l'installation qui est enregistrée : un client qui commande en invité
 * doit recevoir la confirmation de son paiement et l'arrivée de son livreur,
 * sans jamais créer de compte. Le compte, s'il existe, est déduit du jeton de
 * session par le serveur — il n'est jamais envoyé par le client.
 *
 * `phone` est le numéro déclaré sur cet appareil (celui saisi à la commande).
 * Il permet de joindre l'invité ; il n'accorde aucun droit sur un compte.
 */
export class RegisterDeviceDto {
  @ApiProperty({ example: 'a7f3c1e0b9d24f6a' })
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_-]{8,64}$/, {
    message: 'Identifiant d’installation invalide.',
  })
  installationId!: string;

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

  @ApiPropertyOptional({
    example: '0700000001',
    description: 'Numéro déclaré sur cet appareil (commandes invitées).',
  })
  @IsOptional()
  @NormalizePhone()
  @Matches(/^(\+225)?\s?[0-9]{10}$/, { message: 'Numéro ivoirien invalide' })
  phone?: string;

  @ApiPropertyOptional({ example: '1.0.0' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  appVersion?: string;

  /**
   * L'appareil accepte-t-il les offres et promotions ?
   *
   * Absent = on ne touche pas au choix déjà enregistré (un appareil naît
   * acceptant, comme le prévoit le schéma). C'est cette valeur, et elle seule,
   * que consultent les campagnes commerciales : les messages de service
   * (commande, paiement, livraison) ne passent pas par ce filtre.
   */
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  promoOptIn?: boolean;
}

/**
 * Mise à jour d'un appareil déjà enregistré.
 *
 * Deux usages, tous les deux liés à un invité : le numéro saisi à la commande
 * (c'est lui qui permet de le prévenir), et le refus des promotions. Aucun
 * jeton n'est exigé : l'installation suffit à retrouver l'appareil, et cette
 * route n'accorde aucun droit — elle n'écrit qu'un numéro ou une préférence.
 */
export class UpdateDeviceDto {
  @ApiProperty({ example: 'a7f3c1e0b9d24f6a' })
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_-]{8,64}$/, {
    message: 'Identifiant d’installation invalide.',
  })
  installationId!: string;

  @ApiPropertyOptional({ example: '0700000001' })
  @IsOptional()
  @NormalizePhone()
  @Matches(/^(\+225)?\s?[0-9]{10}$/, { message: 'Numéro ivoirien invalide' })
  phone?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  promoOptIn?: boolean;
}

/** Retrait (déconnexion) : l'appareil cesse d'être rattaché au compte. */
export class UnregisterDeviceDto {
  @ApiProperty({ example: 'a7f3c1e0b9d24f6a' })
  @IsString()
  @MaxLength(64)
  installationId!: string;

  @ApiProperty({ example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' })
  @IsString()
  @MaxLength(200)
  token!: string;
}
