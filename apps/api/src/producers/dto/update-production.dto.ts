import { PartialType } from '@nestjs/swagger';

import { CreateProductionDto } from './create-production.dto';

/** Correction d'une déclaration non encore examinée. */
export class UpdateProductionDto extends PartialType(CreateProductionDto) {}
