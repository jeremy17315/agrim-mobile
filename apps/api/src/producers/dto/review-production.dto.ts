import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PRODUCTION_STATUSES, type ProductionStatus } from '@agrim/contracts';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewProductionDto {
  @ApiProperty({ enum: PRODUCTION_STATUSES })
  @IsIn(PRODUCTION_STATUSES)
  status!: ProductionStatus;

  /** Obligatoire en cas de rejet — contrôlé dans le service. */
  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reviewNote?: string;
}
