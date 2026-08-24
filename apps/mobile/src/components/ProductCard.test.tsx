import type { Product } from '@agrim/contracts';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ProductCard } from './ProductCard';

/** Espace insécable étroit produit par formatXof. */
const NB = '\u202F';

/**
 * La vignette annonce un prix : une erreur ici se voit immédiatement par le
 * client et détruit la confiance. On verrouille donc la règle « dès le format
 * le moins cher DISPONIBLE ».
 */

const baseProduct: Product = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'royal-grains',
  name: 'RIZ BOAGNI Royal Grains',
  shortDescription: 'Riz premium, 100 % long grains',
  description: null,
  brand: 'RIZ BOAGNI',
  imageUrl: null,
  category: {
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'royal-grains',
    name: 'Royal Grains',
  },
  isFeatured: true,
  isActive: true,
  variants: [
    {
      id: 'v1',
      sku: 'A-900',
      weightGrams: 900,
      label: '900 g',
      price: 1200,
      originalPrice: null,
      stock: 200,
      isAvailable: true,
    },
    {
      id: 'v2',
      sku: 'A-5000',
      weightGrams: 5000,
      label: '5 kg',
      price: 6000,
      originalPrice: null,
      stock: 200,
      isAvailable: true,
    },
    {
      id: 'v3',
      sku: 'A-22500',
      weightGrams: 22500,
      label: '22,5 kg',
      price: 25000,
      originalPrice: null,
      stock: 40,
      isAvailable: true,
    },
  ],
};

describe('ProductCard', () => {
  it('affiche le nom et le prix du format le moins cher', () => {
    render(<ProductCard product={baseProduct} />);

    expect(screen.getByText('RIZ BOAGNI Royal Grains')).toBeTruthy();
    expect(screen.getByText(`1${NB}200${NB}F`)).toBeTruthy();
    expect(screen.getByText('3 formats')).toBeTruthy();
  });

  it('ignore un format indisponible dans le calcul du prix mini', () => {
    const product: Product = {
      ...baseProduct,
      variants: [
        { ...baseProduct.variants[0]!, price: 500, isAvailable: false },
        { ...baseProduct.variants[1]! },
      ],
    };
    render(<ProductCard product={product} />);

    // 500 F est indisponible : c'est 6 000 F qui doit s'afficher.
    expect(screen.queryByText(`500${NB}F`)).toBeNull();
    expect(screen.getByText(`6${NB}000${NB}F`)).toBeTruthy();
  });

  it('ignore un format à stock nul', () => {
    const product: Product = {
      ...baseProduct,
      variants: [
        { ...baseProduct.variants[0]!, price: 500, stock: 0 },
        { ...baseProduct.variants[1]! },
      ],
    };
    render(<ProductCard product={product} />);
    expect(screen.getByText(`6${NB}000${NB}F`)).toBeTruthy();
  });

  it('signale une rupture quand aucun format n’est disponible', () => {
    const product: Product = {
      ...baseProduct,
      variants: baseProduct.variants.map((v) => ({ ...v, stock: 0 })),
    };
    render(<ProductCard product={product} />);

    expect(screen.getByText('Rupture')).toBeTruthy();
  });

  it('remonte le produit sélectionné au parent', () => {
    const onPress = jest.fn();
    render(<ProductCard product={baseProduct} onPress={onPress} />);

    fireEvent.press(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledWith(baseProduct);
  });

  it('expose un libellé d’accessibilité utile', () => {
    render(<ProductCard product={baseProduct} />);
    expect(
      screen.getByLabelText(
        `RIZ BOAGNI Royal Grains, à partir de 1${NB}200${NB}F`,
      ),
    ).toBeTruthy();
  });

  it('affiche le prix barré du format le moins cher quand une promotion existe', () => {
    const product: Product = {
      ...baseProduct,
      variants: [
        { ...baseProduct.variants[0]!, price: 800, originalPrice: 900 },
      ],
    };
    render(<ProductCard product={product} />);

    expect(screen.getByText(`900${NB}F`)).toBeTruthy();
    expect(screen.getByText(`800${NB}F`)).toBeTruthy();
  });

  it('n’affiche pas de prix barré sans promotion', () => {
    render(<ProductCard product={baseProduct} />);
    // Le prix n'apparaît qu'une fois : pas de doublon en style barré.
    expect(screen.getAllByText(`1${NB}200${NB}F`)).toHaveLength(1);
  });
});
