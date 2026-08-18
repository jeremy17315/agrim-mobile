import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  DELIVERY_PROOF_METHODS,
  type DeliveryProofMethod,
} from '@agrim/contracts';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

class ProofPositionDto {
  @ApiProperty({ example: 6.8276 })
  @IsLatitude()
  latitude!: number;

  @ApiProperty({ example: -5.2893 })
  @IsLongitude()
  longitude!: number;
}

/**
 * Preuve de livraison : SIGNATURE par défaut, PHOTO en repli, combinables.
 *
 * La cohérence fine (fichier présent pour chaque méthode retenue, nom du
 * réceptionnaire exigé avec une signature) est vérifiée par le service via le
 * schéma partagé `submitDeliveryProofSchema`, pour que mobile et API
 * appliquent exactement la même règle.
 */
export class SubmitProofDto {
  @ApiProperty({ enum: DELIVERY_PROOF_METHODS, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @ArrayUnique()
  @IsIn(DELIVERY_PROOF_METHODS, { each: true })
  methods!: DeliveryProofMethod[];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  signatureFileId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  photoFileId?: string;

  @ApiPropertyOptional({ example: 'Awa Koné' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  receivedBy?: string;

  @ApiPropertyOptional({ example: 'Remis au gardien' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ type: ProofPositionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProofPositionDto)
  position?: ProofPositionDto;
}
