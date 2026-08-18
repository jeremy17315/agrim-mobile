import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { NormalizePhone } from '../../common/transforms/normalize-phone';

/**
 * Adresse de livraison en Côte d'Ivoire.
 *
 * L'adressage formel est faible : le numéro de rue n'existe souvent pas. Ce
 * sont la commune, le quartier et surtout le POINT DE REPÈRE qui permettent au
 * livreur de trouver. Le GPS est facultatif — on ne demande pas la permission
 * de localisation tant que l'utilisateur ne la propose pas lui-même.
 */
export class CreateAddressDto {
  @ApiProperty({ example: 'Maison' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  label!: string;

  @ApiProperty({ example: 'Yamoussoukro' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  city!: string;

  @ApiPropertyOptional({ example: 'Habitat' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  commune?: string;

  @ApiPropertyOptional({ example: 'Quartier Millionnaire' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  district?: string;

  @ApiPropertyOptional({
    example: 'En face de la pharmacie du Rond-point',
    description: 'Point de repère : souvent l’information la plus utile.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  landmark?: string;

  @ApiPropertyOptional({ example: 'Portail vert, appeler en arrivant' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  instructions?: string;

  @ApiProperty({ example: '0700000001' })
  @NormalizePhone()
  @Matches(/^(\+225)?\s?[0-9]{10}$/, { message: 'Numéro ivoirien invalide' })
  contactPhone!: string;

  @ApiPropertyOptional({ example: 6.8276 })
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ example: -5.2893 })
  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
