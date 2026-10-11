import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { PROMO_DISCOUNT_TYPES } from '@agrim/contracts';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Création d'un code promo.
 *
 * Toutes les bornes sont vérifiées DEUX fois : ici (400 propre, message
 * lisible) et dans le service (règle métier). Un formulaire d'administration
 * est un client comme un autre : il ne fait pas autorité.
 */
export class CreatePromoCodeDto {
  @ApiProperty({ example: 'BIENVENUE10' })
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  code!: string;

  @ApiPropertyOptional({ example: '10 % sur la première commande' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @ApiProperty({ enum: PROMO_DISCOUNT_TYPES })
  @IsIn(PROMO_DISCOUNT_TYPES)
  discountType!: 'PERCENT' | 'FIXED';

  @ApiProperty({ example: 10, description: 'Pourcentage, ou montant en XOF.' })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  discountValue!: number;

  @ApiPropertyOptional({ example: 10000, description: 'Minimum de panier (XOF).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  minOrderTotal?: number;

  @ApiPropertyOptional({ example: 100, description: 'Nombre maximal d’utilisations.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000)
  maxUses?: number;

  @ApiPropertyOptional({
    example: 1,
    description: 'Utilisations maximales par numéro de téléphone.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxUsesPerPhone?: number;

  @ApiPropertyOptional({ example: 'abidjan', description: 'Zone concernée.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  zone?: string;

  @ApiPropertyOptional({ example: '2026-10-01T00:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59.000Z' })
  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    type: [String],
    example: ['RB-ROY-05'],
    description: 'Références produits concernées. Vide = tout le panier.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  appliesTo?: string[];
}

/** Modification partielle : un champ absent n'est pas touché. */
export class UpdatePromoCodeDto extends PartialType(CreatePromoCodeDto) {}
