import { CategoriesController } from './categories.controller';
import type { PrismaService } from '../prisma/prisma.service';

describe('CategoriesController', () => {
  it('ne renvoie pas les anciennes gammes qui n’ont plus de produit actif', async () => {
    const prisma = {
      db: {
        category: { findMany: jest.fn().mockResolvedValue([]) },
      },
    } as unknown as PrismaService;
    const controller = new CategoriesController(prisma);

    await controller.list();

    expect(prisma.db.category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { products: { some: { isActive: true } } },
      }),
    );
  });
});
