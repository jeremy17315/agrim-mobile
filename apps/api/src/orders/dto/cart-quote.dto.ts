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
}
