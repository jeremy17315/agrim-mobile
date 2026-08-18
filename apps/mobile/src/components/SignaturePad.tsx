import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  PanResponder,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { palette, radius, spacing, typography } from '@/theme/tokens';

/**
 * Surface de signature au doigt.
 *
 * Le tracé est dessiné en SVG, puis exporté en PNG par `toDataURL` de
 * react-native-svg. L'export bitmap n'est pas un détail : le serveur n'accepte
 * que de vraies images (JPEG, PNG, WebP) et vérifie leur signature binaire.
 * Un SVG déguisé en PNG serait rejeté — et il l'a été, avant correction.
 *
 * Le composant ne connaît ni le réseau ni la livraison : il produit un tracé
 * et le remonte. C'est l'écran qui décide quoi en faire.
 */

export type SignaturePadProps = {
  /** Appelé à chaque modification : `null` quand la surface est vide. */
  onChange: (paths: string[] | null) => void;
  /** Hauteur de la zone de dessin. */
  height?: number;
};

/** Poignée d'export exposée à l'écran parent. */
export type SignaturePadHandle = {
  /**
   * Exporte le tracé en PNG (base64, sans préfixe data:).
   * Renvoie `null` si la surface est vide.
   */
  exportPng: () => Promise<string | null>;
};

/** Trace un segment lissé entre deux points. */
function lineTo(x: number, y: number): string {
  return `L${x.toFixed(1)},${y.toFixed(1)}`;
}

export const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(
  function SignaturePad({ onChange, height = 200 }, ref) {
    const [paths, setPaths] = useState<string[]>([]);
    const [current, setCurrent] = useState<string>('');
    const [size, setSize] = useState({ width: 0, height });

    // Le tracé en cours vit aussi dans une ref : PanResponder est créé une seule
    // fois et ne verrait jamais les valeurs d'état rafraîchies.
    const currentRef = useRef('');
    const pathsRef = useRef<string[]>([]);
    const svgRef = useRef<Svg>(null);

    useImperativeHandle(
      ref,
      () => ({
        exportPng: () =>
          new Promise((resolve) => {
            if (pathsRef.current.length === 0 || !svgRef.current) {
              resolve(null);
              return;
            }
            // `toDataURL` rend le SVG côté natif : on obtient un vrai PNG.
            svgRef.current.toDataURL((base64) => resolve(base64));
          }),
      }),
      [],
    );

    const commit = useCallback(
      (next: string[]) => {
        pathsRef.current = next;
        setPaths(next);
        onChange(next.length > 0 ? next : null);
      },
      [onChange],
    );

    const panResponder = useMemo(
      () =>
        PanResponder.create({
          onStartShouldSetPanResponder: () => true,
          onMoveShouldSetPanResponder: () => true,
          // Empêche un parent défilant de voler le geste en pleine signature.
          onPanResponderTerminationRequest: () => false,

          onPanResponderGrant: (event) => {
            const { locationX, locationY } = event.nativeEvent;
            currentRef.current = `M${locationX.toFixed(1)},${locationY.toFixed(1)}`;
            setCurrent(currentRef.current);
          },

          onPanResponderMove: (event) => {
            const { locationX, locationY } = event.nativeEvent;
            currentRef.current += lineTo(locationX, locationY);
            setCurrent(currentRef.current);
          },

          onPanResponderRelease: () => {
            if (currentRef.current.length > 0) {
              commit([...pathsRef.current, currentRef.current]);
            }
            currentRef.current = '';
            setCurrent('');
          },
        }),
      [commit],
    );

    const clear = useCallback(() => {
      currentRef.current = '';
      setCurrent('');
      commit([]);
    }, [commit]);

    const onLayout = useCallback((event: LayoutChangeEvent) => {
      const { width, height: h } = event.nativeEvent.layout;
      setSize({ width, height: h });
    }, []);

    const isEmpty = paths.length === 0 && current.length === 0;

    return (
      <View>
        <View
          style={[styles.surface, { height }]}
          onLayout={onLayout}
          {...panResponder.panHandlers}
          accessibilityLabel="Zone de signature"
        >
          <Svg ref={svgRef} width={size.width} height={size.height}>
            {paths.map((d, index) => (
              <Path
                key={index}
                d={d}
                stroke={palette.ink}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            ))}
            {current.length > 0 ? (
              <Path
                d={current}
                stroke={palette.ink}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            ) : null}
          </Svg>

          {isEmpty ? (
            <View pointerEvents="none" style={styles.placeholder}>
              <Text style={styles.placeholderText}>Signez ici</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.footer}>
          <Text style={styles.hint}>Faites signer le réceptionnaire</Text>
          <Text
            style={[styles.clear, isEmpty && styles.clearDisabled]}
            onPress={isEmpty ? undefined : clear}
            accessibilityRole="button"
            accessibilityState={{ disabled: isEmpty }}
          >
            Effacer
          </Text>
        </View>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  surface: {
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  placeholder: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    ...typography.body,
    color: palette.muted,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  hint: {
    ...typography.caption,
    color: palette.muted,
  },
  clear: {
    ...typography.caption,
    color: palette.green,
    fontWeight: '600',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  clearDisabled: {
    color: palette.muted,
    opacity: 0.5,
  },
});
