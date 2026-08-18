import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

import { CreateFarmDto } from './create-farm.dto';

export class UpdateFarmDto extends PartialType(CreateFarmDto) {
  /** Mise en jachère : la parcelle sort des saisies sans perdre son historique. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
