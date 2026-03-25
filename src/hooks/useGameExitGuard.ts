import { Alert, Platform } from 'react-native';
import { useCallback, useEffect, useRef } from 'react';

const TERMINAL_GAME_STATUSES = new Set(['complete', 'abandoned']);

interface NavigationBeforeRemoveEvent {
  preventDefault: () => void;
  data?: {
    action?: unknown;
  };
}

interface NavigationActionLike {
  type: string;
  payload?: object;
  source?: string;
  target?: string;
}

interface NavigationLike {
  addListener: (eventName: 'beforeRemove', callback: (event: NavigationBeforeRemoveEvent) => void) => () => void;
  dispatch: (action: NavigationActionLike) => void;
}

interface RequestGameExitConfirmationOptions {
  platformOS: string;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  confirmWeb?: (prompt: string) => boolean;
  showNativeAlert?: typeof Alert.alert;
}

interface UseGameExitGuardOptions {
  navigation: NavigationLike;
  gameStatus: string | null | undefined;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onAbandon: () => void;
}

interface UseGameExitGuardResult {
  runProtectedNavigation: (navigate: () => void) => void;
}

export function shouldGuardGameExit(gameStatus: string | null | undefined): boolean {
  if (!gameStatus) {
    return false;
  }

  return !TERMINAL_GAME_STATUSES.has(gameStatus);
}

function isNavigationActionLike(action: unknown): action is NavigationActionLike {
  return Boolean(
    action &&
      typeof action === 'object' &&
      'type' in action &&
      typeof (action as { type?: unknown }).type === 'string'
  );
}

export function requestGameExitConfirmation(options: RequestGameExitConfirmationOptions): void {
  if (options.platformOS === 'web') {
    const webConfirm =
      options.confirmWeb ??
      ((prompt: string) => {
        if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
          return true;
        }
        return window.confirm(prompt);
      });
    if (webConfirm(`${options.title}\n\n${options.message}`)) {
      options.onConfirm();
    }
    return;
  }

  const showAlert = options.showNativeAlert ?? Alert.alert;
  showAlert(options.title, options.message, [
    { text: options.cancelLabel, style: 'cancel' },
    {
      text: options.confirmLabel,
      style: 'destructive',
      onPress: options.onConfirm
    }
  ]);
}

export function useGameExitGuard(options: UseGameExitGuardOptions): UseGameExitGuardResult {
  const allowNextNavigationRef = useRef(false);
  const gameStatusRef = useRef(options.gameStatus);
  const onAbandonRef = useRef(options.onAbandon);

  useEffect(() => {
    gameStatusRef.current = options.gameStatus;
  }, [options.gameStatus]);

  useEffect(() => {
    onAbandonRef.current = options.onAbandon;
  }, [options.onAbandon]);

  const runProtectedNavigation = useCallback(
    (navigate: () => void) => {
      if (!shouldGuardGameExit(gameStatusRef.current)) {
        navigate();
        return;
      }

      requestGameExitConfirmation({
        platformOS: Platform.OS,
        title: options.title,
        message: options.message,
        confirmLabel: options.confirmLabel,
        cancelLabel: options.cancelLabel,
        onConfirm: () => {
          onAbandonRef.current();
          allowNextNavigationRef.current = true;
          navigate();
        }
      });
    },
    [options.cancelLabel, options.confirmLabel, options.message, options.title]
  );

  useEffect(() => {
    const unsubscribe = options.navigation.addListener('beforeRemove', (event) => {
      if (allowNextNavigationRef.current) {
        allowNextNavigationRef.current = false;
        return;
      }

      if (!shouldGuardGameExit(gameStatusRef.current)) {
        return;
      }

      event.preventDefault();
      requestGameExitConfirmation({
        platformOS: Platform.OS,
        title: options.title,
        message: options.message,
        confirmLabel: options.confirmLabel,
        cancelLabel: options.cancelLabel,
        onConfirm: () => {
          onAbandonRef.current();
          allowNextNavigationRef.current = true;
          const action = event.data?.action;
          if (isNavigationActionLike(action)) {
            options.navigation.dispatch(action);
          }
        }
      });
    });

    return unsubscribe;
  }, [options.cancelLabel, options.confirmLabel, options.message, options.navigation, options.title]);

  return {
    runProtectedNavigation
  };
}
