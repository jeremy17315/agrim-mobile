import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PRODUCTION_LIMITS } from '@agrim/contracts';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

export class CreateProductionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  farmId!: string;

  @ApiProperty({ example: 'Saison 2026' })
  @IsString()
  @Length(2, PRODUCTION_LIMITS.maxSeasonLength)
  season!: string;

  @ApiProperty({ example: 'Riz long grain' })
  @IsString()
  @Length(2, PRODUCTION_LIMITS.maxCropVarietyLength)
  cropVariety!: string;

  @ApiProperty({ example: 18000, description: 'Quantité en kilogrammes.' })
  @IsInt()
  @Min(PRODUCTION_LIMITS.minQuantityKg)
  @Max(PRODUCTION_LIMITS.maxQuantityKg)
  quantityKg!: number;

  @ApiPropertyOptional({ example: 20500 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PRODUCTION_LIMITS.maxQuantityKg)
  targetKg?: number;

  @ApiPropertyOptional({ example: '2026-06-15T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  harvestedAt?: string;
}
