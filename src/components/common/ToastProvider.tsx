import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Platform, StyleSheet, Text, View } from 'react-native';
import { theme } from '../../theme';

type ToastType = 'success' | 'error' | 'info';

interface ToastPayload {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
let hasWarnedMissingToastProvider = false;
const USE_NATIVE_DRIVER = Platform.OS !== 'web';

function getToastBackground(type: ToastType): string {
  if (type === 'success') {
    return '#166534';
  }
  if (type === 'error') {
    return '#7F1D1D';
  }
  return '#1E3A8A';
}

interface ToastProviderProps {
  children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toast, setToast] = useState<ToastPayload | null>(null);
  const translateY = useRef(new Animated.Value(26)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const hideToast = useCallback(() => {
    clearTimer();
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: USE_NATIVE_DRIVER }),
      Animated.timing(translateY, { toValue: 20, duration: 180, useNativeDriver: USE_NATIVE_DRIVER })
    ]).start(() => {
      setToast(null);
    });
  }, [clearTimer, opacity, translateY]);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info') => {
      if (!message.trim()) {
        return;
      }
      clearTimer();
      setToast({
        id: Date.now(),
        message: message.trim(),
        type
      });
    },
    [clearTimer]
  );

  useEffect(() => {
    if (!toast) {
      return;
    }

    translateY.setValue(26);
    opacity.setValue(0);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: USE_NATIVE_DRIVER }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: USE_NATIVE_DRIVER, friction: 7, tension: 110 })
    ]).start();

    timerRef.current = setTimeout(() => {
      hideToast();
    }, 2800);

    return () => {
      clearTimer();
    };
  }, [clearTimer, hideToast, opacity, toast, translateY]);

  const value = useMemo<ToastContextValue>(
    () => ({
      showToast,
      success: (message: string) => showToast(message, 'success'),
      error: (message: string) => showToast(message, 'error'),
      info: (message: string) => showToast(message, 'info')
    }),
    [showToast]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? (
        <View pointerEvents="none" style={styles.overlay}>
          <Animated.View
            style={[
              styles.toast,
              { backgroundColor: getToastBackground(toast.type), opacity, transform: [{ translateY }] }
            ]}
          >
            <Text style={styles.message}>{toast.message}</Text>
          </Animated.View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    if (__DEV__ && !hasWarnedMissingToastProvider) {
      hasWarnedMissingToastProvider = true;
      console.warn('[ToastProvider] useToast() called outside ToastProvider. Calls will be no-op.');
    }
    return {
      showToast: () => {},
      success: () => {},
      error: () => {},
      info: () => {}
    };
  }
  return context;
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 28,
    alignItems: 'center',
    zIndex: 60
  },
  toast: {
    maxWidth: 460,
    width: '90%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md
  },
  message: {
    color: theme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '700'
  }
});
