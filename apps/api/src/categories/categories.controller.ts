import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Lister les gammes RIZ BOAGNI' })
  list() {
    return this.prisma.db.category.findMany({
      // Une ancienne catégorie peut rester en base pour préserver l'historique
      // des commandes. Elle ne doit jamais réapparaître comme filtre dans
      // l'app lorsque tous ses produits ont été retirés du rayon.
      where: { products: { some: { isActive: true } } },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        imageUrl: true,
        sortOrder: true,
      },
    });
  }
}
