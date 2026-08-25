import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5, example: 5 })
  @Type(() => Number)
  @IsInt({ message: 'La note doit être un entier.' })
  @Min(1, { message: 'Cochez entre 1 et 5 étoiles.' })
  @Max(5, { message: 'Cochez entre 1 et 5 étoiles.' })
  rating!: number;

  @ApiProperty({ example: 'Riz parfumé, bien gonflé à la cuisson.' })
  @IsString()
  @MinLength(8, { message: 'Écrivez au moins quelques mots (8 caractères).' })
  @MaxLength(800)
  comment!: string;
}
