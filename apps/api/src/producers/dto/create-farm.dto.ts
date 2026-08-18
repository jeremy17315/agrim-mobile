import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FARM_LIMITS } from '@agrim/contracts';
import {
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateFarmDto {
  @ApiProperty({ example: 'Exploitation de Bouaké-Nord' })
  @IsString()
  @Length(2, FARM_LIMITS.maxNameLength)
  name!: string;

  @ApiPropertyOptional({ example: 'Bouaké, région de Gbêkê' })
  @IsOptional()
  @IsString()
  @MaxLength(FARM_LIMITS.maxLocationLength)
  location?: string;

  @ApiPropertyOptional({ example: 12.5 })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(FARM_LIMITS.maxAreaHectares)
  areaHectares?: number;

  // Facultatif : toutes les parcelles ne sont pas relevées au GPS.
  @ApiPropertyOptional({ example: 7.6906 })
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ example: -5.0303 })
  @IsOptional()
  @IsLongitude()
  longitude?: number;
}
