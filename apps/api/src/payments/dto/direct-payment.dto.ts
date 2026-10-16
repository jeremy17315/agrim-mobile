import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PAYMENT_DECLARATION_LIMITS, PAYMENT_METHOD_LIMITS } from '@agrim/contracts';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Configuration d'un moyen de paiement direct.
 *
 * Le numéro de réception est validé en FORME (chiffres, éventuellement
 * préfixés `+225`) mais jamais contre une liste fermée : AGRIM peut publier un
 * numéro d'un opérateur que cette application ne connaît pas encore.
 */
export class UpsertPaymentMethodDto {
  @ApiProperty({ example: 'ORANGE_MONEY' })
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  code!: string;

  @ApiProperty({ example: 'Orange Money' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  operatorName!: string;

  @ApiProperty({ example: '+225 07 00 05 04 52' })
  @IsString()
  @Matches(/^\+?[0-9 .\-()]{6,30}$/, {
    message: 'Numéro de réception invalide.',
  })
  receivingNumber!: string;

  @ApiPropertyOptional({ example: 'AGRIM SARL' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  beneficiaryName?: string;

  @ApiPropertyOptional({
    example:
      'Ouvrez votre application Orange Money, choisissez « Transfert », puis indiquez le numéro ci-dessus.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(600)
  instructions?: string;

  @ApiPropertyOptional({ example: '#144*1*1*{number}*{amount}%23' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  ussdTemplate?: string;

  @ApiPropertyOptional({
    description:
      'Contenu exact du QR marchand de l’opérateur, réaffiché tel quel par l’application. Publier un contenu erroné enverrait l’argent du client à un inconnu.',
    example: 'https://pay.wave.com/m/M_agrim_demo/c/ci/',
  })
  @IsOptional()
  @IsString()
  @MaxLength(PAYMENT_METHOD_LIMITS.qrPayloadMax)
  qrPayload?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder?: number;
}

/**
 * Déclaration de paiement par le client.
 *
 * Aucune de ces valeurs ne fait foi : elles décrivent ce que le client affirme.
 * Le montant attendu, lui, est déjà en base — le client ne l'envoie pas.
 */
export class DeclarePaymentDto {
  @ApiProperty({ example: 'TX123456789', description: 'Référence opérateur.' })
  @IsString()
  @MinLength(PAYMENT_DECLARATION_LIMITS.referenceMin)
  @MaxLength(PAYMENT_DECLARATION_LIMITS.referenceMax)
  transactionReference!: string;

  @ApiProperty({ example: 18500, description: 'Montant réellement transféré (XOF).' })
  // Le formulaire arrive en multipart (justificatif facultatif) : les champs
  // sont donc des chaînes. On les convertit AVANT validation, sinon un montant
  // correct serait rejeté en 400 pour cause de type.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  declaredAmount!: number;

  @ApiPropertyOptional({ example: '2026-10-11T10:30:00.000Z' })
  @IsOptional()
  @IsISO8601()
  paidAt?: string;

  @ApiPropertyOptional({ description: 'Note libre du client.' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

/** Décision d'un vérificateur sur une déclaration. */
export class ReviewPaymentDto {
  @ApiProperty({ enum: ['CONFIRM', 'REJECT', 'REVIEW'] })
  @IsString()
  @Matches(/^(CONFIRM|REJECT|REVIEW)$/, {
    message: 'Décision attendue : CONFIRM, REJECT ou REVIEW.',
  })
  decision!: 'CONFIRM' | 'REJECT' | 'REVIEW';

  @ApiPropertyOptional({
    example: 'Fonds reçus sur le compte marchand, référence vérifiée.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;

  @ApiPropertyOptional({
    example: 'Référence introuvable chez l’opérateur.',
    description: 'Obligatoire en cas de rejet : le client doit comprendre.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  rejectionNote?: string;
}

/** Détail d'une déclaration renvoyé à l'administration. */
export class PaymentDeclarationFilterDto {
  @ApiPropertyOptional({ enum: ['DECLARED', 'VERIFYING', 'ACCEPTED', 'REJECTED'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 'AGR-2026-0042' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  search?: string;

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}
