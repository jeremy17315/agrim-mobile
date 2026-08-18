import { ApiPropertyOptional } from '@nestjs/swagger';
import { STOCK_LIMITS } from '@agrim/contracts';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class AdjustStockDto {
  /**
   * Apport (positif) ou retrait (négatif). Un delta plutôt qu'une valeur
   * absolue : deux saisies simultanées s'additionnent au lieu de s'écraser.
   */
  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @IsInt()
  @Min(-STOCK_LIMITS.maxAdjustment)
  @Max(STOCK_LIMITS.maxAdjustment)
  delta?: number;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @IsInt()
  @Min(STOCK_LIMITS.minThreshold)
  @Max(STOCK_LIMITS.maxThreshold)
  lowStockThreshold?: number;
}
