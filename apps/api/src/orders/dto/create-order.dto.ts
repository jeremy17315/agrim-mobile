import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MOBILE_MONEY_PROVIDERS, PAYMENT_METHODS } from '@agrim/contracts';
import type { MobileMoneyProvider, PaymentMethod } from '@agrim/contracts';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Ligne de commande envoyée par le mobile.
 *
 * Volontairement SANS prix : le client dit ce qu'il veut, pas ce qu'il paie.
 * Accepter un montant venant du téléphone reviendrait à laisser fixer ses
 * propres tarifs.
 */
export class CreateOrderItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  variantId!: string;

  @ApiProperty({ example: 2, minimum: 1, maximum: 999 })
  @IsInt()
  @Min(1)
  @Max(999)
  quantity!: number;
}

export class CreateOrderDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  addressId!: string;

  @ApiProperty({ type: [CreateOrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];

  @ApiProperty({ enum: PAYMENT_METHODS, example: 'CASH_ON_DELIVERY' })
  @IsIn(PAYMENT_METHODS)
  paymentMethod!: PaymentMethod;

  @ApiPropertyOptional({ enum: MOBILE_MONEY_PROVIDERS })
  @IsOptional()
  @IsIn(MOBILE_MONEY_PROVIDERS)
  mobileMoneyProvider?: MobileMoneyProvider;

  /**
   * Clé générée par le mobile AVANT l'envoi. Si le réseau coupe et que
   * l'application rejoue la requête, la même clé renvoie la commande déjà
   * créée au lieu d'en créer une seconde.
   */
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  idempotencyKey!: string;

  @ApiPropertyOptional({ example: 'Livrer avant 18h' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
