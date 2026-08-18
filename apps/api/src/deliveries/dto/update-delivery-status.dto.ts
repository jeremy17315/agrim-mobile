import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DELIVERY_STATUSES, type DeliveryStatus } from '@agrim/contracts';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateDeliveryStatusDto {
  @ApiProperty({ enum: DELIVERY_STATUSES, example: 'PICKED_UP' })
  @IsIn(DELIVERY_STATUSES)
  status!: DeliveryStatus;

  /** Obligatoire pour un échec : une course ratée sans motif est inexploitable. */
  @ApiPropertyOptional({ example: 'Client absent après deux appels' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  failureReason?: string;
}
