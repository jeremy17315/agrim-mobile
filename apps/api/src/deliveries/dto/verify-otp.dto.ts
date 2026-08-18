import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

import { DELIVERY_OTP_CONFIG } from '@agrim/contracts';

class OtpPositionDto {
  @ApiProperty()
  @IsLatitude()
  latitude!: number;

  @ApiProperty()
  @IsLongitude()
  longitude!: number;
}

export class VerifyOtpDto {
  /**
   * Code dicté par le client. Normalisé avant validation : un client qui dicte
   * « 12 34 » ne doit pas provoquer un refus dû à la mise en forme.
   */
  @ApiProperty({ example: '4821', description: 'Code à 4 chiffres du client' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().replace(/[\s.-]/g, '') : value,
  )
  @IsString()
  @Matches(new RegExp(`^[0-9]{${DELIVERY_OTP_CONFIG.length}}$`), {
    message: `Code à ${DELIVERY_OTP_CONFIG.length} chiffres requis`,
  })
  code!: string;

  /**
   * Position à la validation. Facultative : le GPS documente la remise, il ne
   * la conditionne pas. Un signal absent ne bloque pas une livraison réelle.
   */
  @ApiPropertyOptional({ type: OtpPositionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => OtpPositionDto)
  position?: OtpPositionDto;
}
