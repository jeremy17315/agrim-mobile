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

  /**
   * `MOBILE_MONEY` reste accepté pour les applications DÉJÀ INSTALLÉES : le
   * serveur le convertit en transfert direct, jamais en encaissement par
   * agrégateur. Refuser la requête priverait ces clients de la commande alors
   * que leur intention — payer par mobile money — reste satisfaite.
   */
  @ApiProperty({
    enum: ['CASH_ON_DELIVERY', 'MOBILE_MONEY', 'DIRECT_MOBILE_MONEY'],
    default: 'CASH_ON_DELIVERY',
  })
  @IsOptional()
  @IsIn(['CASH_ON_DELIVERY', 'MOBILE_MONEY', 'DIRECT_MOBILE_MONEY'])
  paymentMethod?: 'CASH_ON_DELIVERY' | 'MOBILE_MONEY' | 'DIRECT_MOBILE_MONEY';

  @ApiProperty({ enum: MOBILE_MONEY_PROVIDERS, required: false })
  @ValidateIf(
    (value: CreateGuestOrderDto) => value.paymentMethod === 'MOBILE_MONEY',
  )
  @IsIn(MOBILE_MONEY_PROVIDERS)
  mobileMoneyProvider?: (typeof MOBILE_MONEY_PROVIDERS)[number];

  /**
   * Opérateur choisi pour le transfert direct. Code technique uniquement
   * (`ORANGE_MONEY`, `MTN_MOMO`, `WAVE`…) : le numéro officiel de réception est
   * résolu côté serveur, jamais transmis par le téléphone.
   */
  @ApiProperty({ example: 'ORANGE_MONEY', required: false })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9_]{2,40}$/, {
    message: 'Code de moyen de paiement invalide.',
  })
  paymentMethodCode?: string;

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

  /** Identifiant d'installation de l'appareil : permet les notifications de suivi. */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9-]{16,64}$/)
  installationId?: string;
}
