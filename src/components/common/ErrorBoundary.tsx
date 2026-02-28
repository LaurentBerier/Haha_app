import { Component, type ErrorInfo, type ReactNode } from 'react';
import { DevSettings, Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../../theme';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    if (__DEV__) {
      console.error('[ErrorBoundary] Uncaught render error:', error, info);
    }
  }

  private handleRestart = (): void => {
    if (__DEV__ && typeof DevSettings.reload === 'function') {
      DevSettings.reload();
      return;
    }

    this.setState({ hasError: false });
  };

  override render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <View style={styles.screen} testID="error-boundary-fallback">
        <Text style={styles.title}>Something went wrong.</Text>
        <Text style={styles.subtitle}>Please restart the app to continue.</Text>
        <Pressable onPress={this.handleRestart} style={styles.button} accessibilityRole="button">
          <Text style={styles.buttonLabel}>Restart</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.background
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: 24,
    fontWeight: '700'
  },
  subtitle: {
    marginTop: theme.spacing.sm,
    color: theme.colors.textMuted,
    fontSize: 14,
    textAlign: 'center'
  },
  button: {
    marginTop: theme.spacing.lg,
    borderRadius: 10,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    backgroundColor: theme.colors.accent
  },
  buttonLabel: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '700'
  }
});
