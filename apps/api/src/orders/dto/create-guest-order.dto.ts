import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { CreateOrderItemDto } from './create-order.dto';

/**
 * Corps minimal du checkout public. Les montants, frais et mode de paiement
 * restent volontairement absents : le serveur les décide et la commande est
 * réglée à la livraison dans ce parcours sans compte.
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

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  idempotencyKey!: string;
}
