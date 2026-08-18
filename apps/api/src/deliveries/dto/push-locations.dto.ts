import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/** Position brute remontée par le terminal du livreur. */
export class GeoPointDto {
  @ApiProperty({ example: 6.8276 })
  @IsLatitude()
  latitude!: number;

  @ApiProperty({ example: -5.2893 })
  @IsLongitude()
  longitude!: number;

  /** Précision horizontale en mètres. */
  @ApiPropertyOptional({ example: 12.5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000)
  accuracy?: number;

  /** Cap en degrés, 0 = nord. */
  @ApiPropertyOptional({ example: 145 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(360)
  heading?: number;

  /** Vitesse instantanée en m/s. */
  @ApiPropertyOptional({ example: 8.3 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(70)
  speed?: number;

  /** Horodatage de la MESURE, pas de la réception serveur. */
  @ApiProperty({ example: '2026-08-18T14:05:00.000Z' })
  @IsISO8601()
  recordedAt!: string;
}

/**
 * Lot de positions.
 *
 * Le livreur envoie un lot, jamais un point isolé : en zone de couverture
 * faible, les points sont mis en file localement puis rejoués au retour du
 * réseau.
 */
export class PushLocationsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  deliveryId!: string;

  @ApiProperty({ type: [GeoPointDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => GeoPointDto)
  points!: GeoPointDto[];
}
