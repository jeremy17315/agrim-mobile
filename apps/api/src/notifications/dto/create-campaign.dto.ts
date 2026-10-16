import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CAMPAIGN_AUDIENCES,
  CAMPAIGN_LIMITS,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_TARGETS,
} from '@agrim/contracts';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Rédaction d'une campagne depuis l'administration.
 *
 * Les bornes et les listes viennent du contrat partagé : le formulaire du
 * mobile et le serveur appliquent exactement les mêmes règles, il n'existe pas
 * deux définitions de ce qu'est une campagne valide.
 */
export class CreateCampaignDto {
  @ApiProperty({ example: 'Riz Royal Grains : nouveau format 10 kg' })
  @IsString()
  @MinLength(CAMPAIGN_LIMITS.titleMin, { message: 'Titre trop court.' })
  @MaxLength(CAMPAIGN_LIMITS.titleMax, { message: 'Titre trop long.' })
  title!: string;

  @ApiProperty({ example: 'Disponible dès cette semaine. Passez commande.' })
  @IsString()
  @MinLength(CAMPAIGN_LIMITS.bodyMin, { message: 'Message trop court.' })
  @MaxLength(CAMPAIGN_LIMITS.bodyMax, { message: 'Message trop long.' })
  body!: string;

  @ApiProperty({ enum: NOTIFICATION_CATEGORIES })
  @IsIn([...NOTIFICATION_CATEGORIES])
  category!: (typeof NOTIFICATION_CATEGORIES)[number];

  @ApiProperty({ enum: NOTIFICATION_TARGETS })
  @IsIn([...NOTIFICATION_TARGETS])
  linkTarget!: (typeof NOTIFICATION_TARGETS)[number];

  @ApiPropertyOptional({ example: 'riz-royal-grains' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  linkValue?: string;

  @ApiProperty({ enum: CAMPAIGN_AUDIENCES })
  @IsIn([...CAMPAIGN_AUDIENCES])
  audience!: (typeof CAMPAIGN_AUDIENCES)[number];
}
