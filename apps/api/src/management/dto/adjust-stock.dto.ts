import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  MANUAL_STOCK_MOVEMENT_TYPES,
  STOCK_LIMITS,
  type ManualStockMovementType,
} from '@agrim/contracts';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

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

  /**
   * Raison du mouvement. Facultative : sans elle, le sens du `delta` décide
   * (`ENTREE` si positif, `SORTIE` si négatif). La préciser sert surtout à
   * distinguer une correction d'inventaire d'une vraie sortie de marchandise
   * — deux gestes que le seul signe ne sépare pas.
   *
   * `COMMANDE` et `ANNULATION` sont refusés ici : ils appartiennent au
   * système, et les saisir à la main falsifierait l'historique des ventes.
   */
  @ApiPropertyOptional({ enum: MANUAL_STOCK_MOVEMENT_TYPES, example: 'ENTREE' })
  @IsOptional()
  @IsIn(MANUAL_STOCK_MOVEMENT_TYPES)
  type?: ManualStockMovementType;

  /**
   * Motif libre, obligatoire pour un `AJUSTEMENT` : une correction
   * d'inventaire sans explication est exactement ce que le journal des
   * mouvements existe pour empêcher.
   */
  @ApiPropertyOptional({
    example: 'Comptage physique du 29/08 : 3 sacs éventrés',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @IsInt()
  @Min(STOCK_LIMITS.minThreshold)
  @Max(STOCK_LIMITS.maxThreshold)
  lowStockThreshold?: number;
}
