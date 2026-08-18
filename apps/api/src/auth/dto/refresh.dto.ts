import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class RefreshDto {
  @ApiProperty({
    description: 'Refresh token (stocké en SecureStore côté mobile)',
  })
  @IsString()
  @MinLength(10)
  refreshToken!: string;
}
