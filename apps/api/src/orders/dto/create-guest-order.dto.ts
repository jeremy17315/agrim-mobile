import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { MOBILE_MONEY_PROVIDERS } from '@agrim/contracts';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { CreateOrderItemDto } from './create-order.dto';

/**
 * Corps minimal du checkout public. Les montants et frais restent décidés par
 * le serveur ; l’invité choisit seulement le même règlement que sur le site :
 * comptant à la livraison ou Mobile Money avec son opérateur.
 */
export class CreateGuestOrderDto {
  @ApiProperty({ example: 'Awa Koné' })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  customerName!: string;

  @ApiProperty({ example: '07 00 00 00 01' })
  @IsString()
  @Matches(/^(\+225)?[0-9 .-]{10,20}$/, {
    message: 'Numéro ivoirien invalide',
  })
  phone!: string;

  @ApiProperty({ example: 'Cocody Angré, près de la pharmacie' })
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  deliveryLocation!: string;

  @ApiProperty({ type: [CreateOrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];

  @ApiProperty({
    enum: ['CASH_ON_DELIVERY', 'MOBILE_MONEY'],
    default: 'CASH_ON_DELIVERY',
  })
  @IsOptional()
  @IsIn(['CASH_ON_DELIVERY', 'MOBILE_MONEY'])
  paymentMethod?: 'CASH_ON_DELIVERY' | 'MOBILE_MONEY';

  @ApiProperty({ enum: MOBILE_MONEY_PROVIDERS, required: false })
  @ValidateIf(
    (value: CreateGuestOrderDto) => value.paymentMethod === 'MOBILE_MONEY',
  )
  @IsIn(MOBILE_MONEY_PROVIDERS)
  mobileMoneyProvider?: (typeof MOBILE_MONEY_PROVIDERS)[number];

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  idempotencyKey!: string;

  /** Code promo : relaqué au calculateur du site, seul juge du rabais. */
  @ApiProperty({ required: false, example: 'BIENVENUE10' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  codePromo?: string;

  /** Note pour le livreur — le site en propose une à sa page de commande. */
  @ApiProperty({ required: false, example: 'Appeler avant d’arriver' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
