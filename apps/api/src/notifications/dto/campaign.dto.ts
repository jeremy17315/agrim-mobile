import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Campagne rédigée par l'administrateur.
 *
 * `audience = TEST` : envoi à SES propres appareils, pour vérifier le rendu
 * avant tout envoi général. `audience = ALL_OPTED_IN` : tous les appareils qui
 * ont accepté les promotions — et seulement avec `confirm: true`.
 */
export class CreateCampaignDto {
  @ApiProperty({ enum: ['PROMOTION', 'NOUVEAU_PRODUIT', 'PROMO_CODE', 'INFORMATION'] })
  @IsIn(['PROMOTION', 'NOUVEAU_PRODUIT', 'PROMO_CODE', 'INFORMATION'])
  category!: string;

  @ApiProperty({ example: 'Nouveau : riz noir disponible' })
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title!: string;

  @ApiProperty()
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  body!: string;

  @ApiPropertyOptional({ description: 'Image HTTPS facultative.' })
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  imageUrl?: string;

  @ApiPropertyOptional({ enum: ['produit', 'offre', 'categorie', 'commande', 'information'] })
  @IsOptional()
  @IsIn(['produit', 'offre', 'categorie', 'commande', 'information'])
  linkTarget?: string;

  @ApiPropertyOptional({ description: 'Slug ou référence de la destination.' })
  @IsOptional()
  @Matches(/^[A-Za-z0-9._-]{1,120}$/, { message: 'Destination invalide.' })
  linkValue?: string;

  @ApiProperty({ enum: ['TEST', 'ALL_OPTED_IN'] })
  @IsIn(['TEST', 'ALL_OPTED_IN'])
  audience!: 'TEST' | 'ALL_OPTED_IN';

  @ApiPropertyOptional({ description: 'Confirmation explicite de l’envoi général.' })
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}
