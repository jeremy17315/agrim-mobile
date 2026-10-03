import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Une ligne du panier TELLE QUE LE CLIENT LE DIT — jamais ce qu'il paie. */
export class CartQuoteItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  variantId!: string;

  @ApiProperty({ example: 2, minimum: 1, maximum: 999 })
  @IsInt()
  @Min(1)
  @Max(999)
  quantity!: number;
}

export class CartQuoteDto {
  @ApiProperty({ type: [CartQuoteItemDto], minItems: 1, maxItems: 50 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  items!: CartQuoteItemDto[];

  /** Ville de livraison, telle que saisie — la zone est résolue CÔTÉ
   * SERVEUR depuis la grille officielle (jamais envoyée par le client). */
  @ApiPropertyOptional({ example: 'Abidjan', required: false })
  @IsOptional()
  @IsString()
  city?: string;

  /**
   * Code promo saisi par le client.
   *
   * Il n'est jamais interprété ici : le site seul connaît ses codes, leurs
   * dates et leurs plafonds. Ce champ n'est qu'un RELAIS vers son calculateur,
   * seul juge de la remise accordée.
   */
  @ApiPropertyOptional({ example: 'BIENVENUE10', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  codePromo?: string;

  /** Téléphone : accompagne le code pour le plafond « une fois par client ». */
  @ApiPropertyOptional({ example: '07 00 00 00 01', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(25)
  phone?: string;
}
