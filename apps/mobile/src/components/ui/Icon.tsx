import LucideIcon from '@react-native-vector-icons/lucide';
import type { ColorValue } from 'react-native';

import { palette, type PaletteColor } from '@/theme/tokens';

/**
 * Icônes de l'application.
 *
 * Une seule famille : Lucide, via `@react-native-vector-icons/lucide`.
 * `@expo/vector-icons` n'est volontairement pas utilisé — Expo ne le
 * recommande plus et annonce sa dépréciation ; les paquets scopés appellent
 * directement l'API native d'expo-font et allègent le bundle.
 *
 * Ce composant existe pour que les écrans ne dépendent jamais du nom du
 * paquet : changer de famille d'icônes se ferait ici, pas dans 30 fichiers.
 */

/** Noms utilisés dans l'application, alignés sur la maquette validée. */
export type IconName = React.ComponentProps<typeof LucideIcon>['name'];

export type IconProps = {
  name: IconName;
  size?: number;
  /**
   * Jeton de palette, ou couleur brute. `ColorValue` est accepté car les
   * navigateurs (barre d'onglets) fournissent leurs propres couleurs.
   */
  color?: PaletteColor | ColorValue;
  accessibilityLabel?: string;
};

export function Icon({
  name,
  size = 18,
  color = 'ink',
  accessibilityLabel,
}: IconProps) {
  const resolved =
    typeof color === 'string' && color in palette
      ? palette[color as PaletteColor]
      : (color as ColorValue);

  return (
    <LucideIcon
      name={name}
      size={size}
      color={resolved}
      accessibilityLabel={accessibilityLabel}
      // Décoratif par défaut : sans libellé, l'icône est ignorée des lecteurs
      // d'écran plutôt que lue comme un caractère parasite.
      accessibilityElementsHidden={accessibilityLabel === undefined}
      importantForAccessibility={
        accessibilityLabel === undefined ? 'no' : 'yes'
      }
    />
  );
}
