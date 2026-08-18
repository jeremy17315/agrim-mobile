import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Au moins 8 caractères' })
  @Matches(/[A-Za-z]/, { message: 'Doit contenir une lettre' })
  @Matches(/[0-9]/, { message: 'Doit contenir un chiffre' })
  newPassword!: string;
}
