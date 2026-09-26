import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class UpdateDeliveryFeeDto {
  @ApiProperty({ example: 3500, minimum: 0 })
  @IsInt()
  @Min(0)
  deliveryFee!: number;
}
