import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RECEPTION_MODES, type ReceptionMode } from '@agrim/contracts';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { NormalizePhone } from '../../common/transforms/normalize-phone';

export class CreateGuestOrderItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  variantId!: string;

  @ApiProperty({ minimum: 1, maximum: 999 })
  @IsInt()
  @Min(1)
  @Max(999)
  quantity!: number;
}

/** Données minimales du parcours achat sans compte. */
export class CreateGuestOrderDto {
  @ApiProperty({ example: 'Awa Koné' })
  @IsString()
  @Min(2)
  @MaxLength(160)
  customerName!: string;

  @ApiProperty({ example: '0700000001' })
  @NormalizePhone()
  @IsString()
  @MaxLength(20)
  customerPhone!: string;

  @ApiProperty({ type: [CreateGuestOrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateGuestOrderItemDto)
  items!: CreateGuestOrderItemDto[];

  @ApiProperty({ enum: RECEPTION_MODES })
  @IsIn(RECEPTION_MODES)
  receptionMode!: ReceptionMode;

  @ApiProperty({ example: 'Yamoussoukro' })
  @IsString()
  @Min(1)
  @MaxLength(80)
  city!: string;

  @ApiPropertyOptional({ example: 'Koko' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  district?: string;

  @ApiPropertyOptional({ example: 'Près de la pharmacie X' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  landmark?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  pickupPointId?: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  idempotencyKey!: string;
}
