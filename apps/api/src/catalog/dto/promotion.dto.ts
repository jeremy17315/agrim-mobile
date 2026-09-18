import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreatePromotionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  variantId!: string;

  @ApiProperty({
    example: 1990,
    description: 'Prix promotionnel en XOF entier — strictement inférieur au prix de base.',
  })
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  priceXof!: number;

  @ApiProperty({ example: 'Rentrée' })
  @IsString()
  @MaxLength(80)
  label!: string;

  @ApiPropertyOptional({ description: 'Début. Absent : immédiat.' })
  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @ApiPropertyOptional({ description: 'Fin. Absente : jusqu’à désactivation.' })
  @IsOptional()
  @IsISO8601()
  endsAt?: string;
}

export class UpdatePromotionDto {
  @ApiPropertyOptional({ description: 'Désactiver la promotion (le prix de base reprend).' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Modifier ou avancer la date de fin.' })
  @IsOptional()
  @IsISO8601()
  endsAt?: string;
}
