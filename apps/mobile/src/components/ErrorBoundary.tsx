import { Component, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Icon, Text } from '@/components/ui';
import { palette, spacing } from '@/theme/tokens';

/**
 * Filet de sécurité pour les erreurs de rendu React.
 *
 * Sans cette barrière, une exception levée pendant le rendu d'un écran fait
 * planter toute l'application (écran blanc/crash natif) sans aucune trace
 * pour l'équipe. Ici on affiche un écran de secours et on garde une trace en
 * console — l'ajout d'un outil de remontée d'incident (Sentry ou équivalent)
 * reste une décision séparée, non prise ici.
 */

type Props = { children: ReactNode };
type State = { hasError: boolean };

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: unknown, info: { componentStack: string }) {
    console.error('[ErrorBoundary] Rendu interrompu par une exception :', error, info.componentStack);
  }

  private reset = () => this.setState({ hasError: false });

  override render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View style={styles.screen}>
        <View style={styles.bubble}>
          <Icon name="triangle-alert" size={26} color="danger" />
        </View>
        <Text variant="h3" center>
          Un problème est survenu
        </Text>
        <Text variant="caption" color="muted" center>
          L’application a rencontré une erreur inattendue. Réessayez ; si le problème persiste, redémarrez l’application.
        </Text>
        <Button
          label="Réessayer"
          variant="outline"
          size="sm"
          fullWidth={false}
          onPress={this.reset}
          icon={<Icon name="refresh-cw" size={14} color="green" />}
        />
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    backgroundColor: palette.bg,
  },
  bubble: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#FBE9E7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
});
