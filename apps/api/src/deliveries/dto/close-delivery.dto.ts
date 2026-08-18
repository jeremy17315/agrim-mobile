import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CloseDeliveryDto {
  /**
   * Motif de la clôture d'exception.
   *
   * Longueur minimale volontaire : « ok » ou « ras » ne documente rien. En cas
   * de litige, ce texte est la seule explication de pourquoi la remise n'a pas
   * été confirmée par le client.
   */
  @ApiProperty({
    example: 'Téléphone du client déchargé, colis remis en main propre',
    minLength: 10,
  })
  @IsString()
  @MinLength(10, {
    message: 'Indiquez précisément pourquoi le code n’a pas pu être utilisé.',
  })
  @MaxLength(500)
  reason!: string;
}
