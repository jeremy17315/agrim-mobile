import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  Platform,
  StyleSheet,
  View,
} from 'react-native';

import { Button, Icon, Text } from '@/components/ui';
import { palette, radius, shadow, spacing } from '@/theme/tokens';

/**
 * Porte d'entrée du parcours : un seul geste, un grand bouton COMMENCER.
 *
 * La page est dépouillée de tout ce qui retardait l'entrée — ni menu, ni
 * compte, ni argumentaire — et rhabillée du strict nécessaire : le logo, un
 * filet doré, le bouton. Deux halos très pâles donnent de la profondeur au
 * fond ivoire sans rien ajouter à lire. Rien à décider, une seule action.
 *
 * Animations : le bloc se pose en fondu au chargement, le bouton respire
 * lentement pour attirer l'œil vers la seule action possible, et il s'enfonce
 * sous le doigt. L'ensemble est neutralisé si le système demande de réduire
 * les animations (accessibilité) — l'écran reste alors pleinement lisible.
 */

/**
 * Le pilote natif n'existe pas sur le web : l'activer y ferait basculer
 * l'animation en JavaScript en émettant un avertissement à chaque image.
 * Sur téléphone, il fait porter le calcul par la couche native (aucun travail
 * sur le fil JavaScript pendant la pulsation).
 */
const PILOTE_NATIF = Platform.OS !== 'web';

/** Durée d'un aller ou d'un retour de la respiration du bouton. */
const RESPIRATION_MS = 1500;

/** Demande du système, sans jamais faire échouer l'écran si elle est absente. */
async function mouvementReduitDemande(): Promise<boolean> {
  try {
    return await AccessibilityInfo.isReduceMotionEnabled();
  } catch {
    return false;
  }
}

export default function WelcomeScreen() {
  const router = useRouter();

  /**
   * Valeurs animées, créées une seule fois.
   *
   * `useState` avec initialisation paresseuse plutôt que `useRef(...).current` :
   * la valeur doit être lue PENDANT le rendu pour alimenter les styles, ce que
   * les règles React Compiler du projet interdisent à un `ref`.
   */
  /** 0 → 1 : apparition du bloc. */
  const [entree] = useState(() => new Animated.Value(0));
  /** 0 → 1 → 0 : respiration du bouton, en boucle. */
  const [respiration] = useState(() => new Animated.Value(0));
  /** Échelle appliquée sous le doigt. */
  const [pression] = useState(() => new Animated.Value(1));

  useEffect(() => {
    let vivant = true;
    let boucle: Animated.CompositeAnimation | null = null;

    const demarrer = (mouvementReduit: boolean) => {
      if (!vivant) return;

      // Mouvement réduit demandé par le système : on affiche directement
      // l'état final, sans fondu ni pulsation.
      if (mouvementReduit) {
        entree.setValue(1);
        return;
      }

      Animated.timing(entree, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: PILOTE_NATIF,
      }).start();

      boucle = Animated.loop(
        Animated.sequence([
          Animated.timing(respiration, {
            toValue: 1,
            duration: RESPIRATION_MS,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: PILOTE_NATIF,
          }),
          Animated.timing(respiration, {
            toValue: 0,
            duration: RESPIRATION_MS,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: PILOTE_NATIF,
          }),
        ]),
      );
      boucle.start();
    };

    void mouvementReduitDemande().then(demarrer);

    // Sans cet arrêt, la boucle continuerait après le démontage de l'écran
    // (changement d'écran, rechargement à chaud) : travail pour rien.
    return () => {
      vivant = false;
      boucle?.stop();
    };
  }, [entree, respiration]);

  // Respiration (amplitude discrète : 3,5 %) multipliée par l'enfoncement.
  const echelle = Animated.multiply(
    respiration.interpolate({ inputRange: [0, 1], outputRange: [1, 1.035] }),
    pression,
  );

  const apparition = {
    opacity: entree,
    transform: [
      {
        translateY: entree.interpolate({
          inputRange: [0, 1],
          outputRange: [16, 0],
        }),
      },
    ],
  };

  return (
    <View style={styles.screen} testID="accueil">
      {/* Décor : deux halos pâles, purement visuels et hors du parcours de
          lecture (les lecteurs d'écran les ignorent). */}
      <View style={styles.haloOr} />
      <View style={styles.haloVert} />

      <Animated.View style={[styles.bloc, apparition]}>
        <Image
          source={require('../../assets/logo-agrim.png')}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="Logo AGRIM"
        />

        <View style={styles.filet} />

        {/* L'ombre portée fait décoller le bouton du fond ivoire ; l'échelle
            animée, elle, est portée par ce conteneur, pas par le bouton
            partagé — le reste de l'application garde son rendu habituel. */}
        <Animated.View
          style={[styles.action, { transform: [{ scale: echelle }] }]}
        >
          <Button
            label="COMMENCER"
            size="lg"
            icon={<Icon name="arrow-right" size={20} color="white" />}
            onPress={() => router.push('/catalogue')}
            onPressIn={() =>
              Animated.spring(pression, {
                toValue: 0.97,
                speed: 40,
                bounciness: 0,
                useNativeDriver: PILOTE_NATIF,
              }).start()
            }
            onPressOut={() =>
              Animated.spring(pression, {
                toValue: 1,
                speed: 20,
                bounciness: 8,
                useNativeDriver: PILOTE_NATIF,
              }).start()
            }
          />
        </Animated.View>

        <Text variant="caption" color="muted" center style={styles.note}>
          Commandez en toute sécurité
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    backgroundColor: palette.bg,
    // Les halos sont posés à cheval sur les bords et rognés au cadre : sans
    // cela, ils déborderaient et créeraient une barre de défilement web.
    overflow: 'hidden',
  },
  haloOr: {
    position: 'absolute',
    top: -96,
    right: -72,
    width: 240,
    height: 240,
    borderRadius: radius.pill,
    backgroundColor: palette.goldSoft,
    pointerEvents: 'none',
  },
  haloVert: {
    position: 'absolute',
    bottom: -120,
    left: -88,
    width: 288,
    height: 288,
    borderRadius: radius.pill,
    backgroundColor: palette.greenSoft,
    pointerEvents: 'none',
  },
  bloc: {
    alignItems: 'center',
    width: '100%',
    maxWidth: 340,
    gap: spacing.md,
  },
  logo: { width: 136, height: 54 },
  filet: {
    width: 32,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: palette.gold,
    marginBottom: spacing.md,
  },
  // Sur une tablette ou dans l'aperçu web, un bouton pleine largeur serait
  // démesuré : il reste grand, mais borné, et toujours centré.
  action: {
    width: '100%',
    borderRadius: radius.lg,
    ...shadow.card,
  },
  note: { marginTop: spacing.sm },
});
