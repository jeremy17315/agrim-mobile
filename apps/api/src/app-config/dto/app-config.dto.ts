import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Coordonnées de contact publiées dans l'application. */
export class UpdateSupportDto {
  @ApiPropertyOptional({ example: '+225 07 00 05 04 52' })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9 .\-()]{6,30}$/, {
    message: 'Numéro de téléphone invalide.',
  })
  phone?: string;

  @ApiPropertyOptional({ example: '+225 27 20 36 32 83' })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9 .\-()]{6,30}$/, {
    message: 'Numéro fixe invalide.',
  })
  landlinePhone?: string;

  @ApiPropertyOptional({
    example: '2250700050452',
    description: 'Format international, sans espaces (lien WhatsApp).',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{8,15}$/, {
    message: 'Numéro WhatsApp attendu au format international, sans espaces.',
  })
  whatsapp?: string;

  @ApiPropertyOptional({ example: 'contact@agrim.ci' })
  @IsOptional()
  @IsEmail({}, { message: 'Adresse e-mail invalide.' })
  email?: string;
}

/** Textes affichés sur l'écran livraison. */
export class UpdateDeliveryInfoDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(600)
  summary!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(600)
  delays!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(600)
  pickupConditions!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(600)
  feeNotice!: string;
}

/** Une question fréquente rédigée par AGRIM. */
export class FaqEntryDto {
  @ApiProperty({ example: 'Comment payer ma commande ?' })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  question!: string;

  @ApiProperty({ example: 'Vous transférez le montant vers le numéro officiel d’AGRIM, puis vous déclarez la transaction dans l’application.' })
  @IsString()
  @MinLength(3)
  @MaxLength(1200)
  answer!: string;
}

export class UpdateFaqDto {
  @ApiProperty({ type: [FaqEntryDto] })
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => FaqEntryDto)
  entries!: FaqEntryDto[];
}

/**
 * Création ou modification d'un point de vente.
 *
 * `isActive` vaut `false` par défaut : un point publié par erreur ferait
 * déplacer des clients. Il est relu puis publié explicitement, comme un code
 * promo.
 */
export class UpsertPointOfSaleDto {
  @ApiProperty({ example: 'Usine AGRIM — Aboukro' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'Aboukro Extension, route de Bouaké' })
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  address!: string;

  @ApiProperty({ example: 'Yamoussoukro' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  city!: string;

  @ApiPropertyOptional({ example: 'À côté de la station' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  landmark?: string;

  @ApiPropertyOptional({ example: '+225 07 00 05 04 52' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional({ example: 'Lun–Sam 8h–18h' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  openingHours?: string;

  @ApiPropertyOptional({ example: 6.8276 })
  @IsOptional()
  @Type(() => Number)
  latitude?: number;

  @ApiPropertyOptional({ example: -5.2893 })
  @IsOptional()
  @Type(() => Number)
  longitude?: number;

  @ApiPropertyOptional({
    default: true,
    description: 'Le point accepte le retrait des commandes de l’application.',
  })
  @IsOptional()
  @IsBoolean()
  supportsPickup?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder?: number;
}

/** Annonce affichée en haut du catalogue. Vide = aucun bandeau. */
export class UpdateAnnouncementDto {
  @ApiPropertyOptional({ example: 'Livraison offerte à partir de 75 kg.' })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  message?: string | null;
}
