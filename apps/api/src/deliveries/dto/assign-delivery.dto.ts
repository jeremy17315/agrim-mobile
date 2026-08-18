import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AssignDeliveryDto {
  @ApiProperty({ format: 'uuid', description: 'Identifiant du livreur' })
  @IsUUID()
  courierId!: string;
}
