import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Matches, MaxLength } from 'class-validator';

export class RegisterTokenDto {
  @ApiProperty({ example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' })
  @IsString()
  @MaxLength(200)
  // Format Expo : rejeter tôt évite de stocker des jetons inexploitables.
  @Matches(/^ExponentPushToken\[[^\]]+\]$/, {
    message: 'Jeton de notification invalide.',
  })
  token!: string;

  @ApiProperty({ enum: ['ios', 'android'] })
  @IsIn(['ios', 'android'])
  platform!: string;
}
