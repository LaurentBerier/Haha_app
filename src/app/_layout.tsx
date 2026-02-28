import { Stack, router, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { ErrorBoundary } from '../components/common/ErrorBoundary';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { useAuth } from '../hooks/useAuth';
import { useStorePersistence } from '../hooks/useStorePersistence';
import { t } from '../i18n';
import { useStore } from '../store/useStore';
import { theme } from '../theme';

export default function RootLayout() {
  useStorePersistence();
  const hasHydrated = useStore((state) => state.hasHydrated);
  const { authStatus, isAuthenticated, userProfile } = useAuth();
  const segments = useSegments();
  const inAuthGroup = segments[0] === '(auth)';
  const isOnboardingRoute = segments[1] === 'onboarding';
  const needsOnboarding =
    isAuthenticated && userProfile ? !userProfile.onboardingCompleted && !userProfile.onboardingSkipped : false;

  useEffect(() => {
    if (!hasHydrated || authStatus === 'loading') {
      return;
    }

    if (!isAuthenticated) {
      if (!inAuthGroup || isOnboardingRoute) {
        router.replace('/(auth)/login');
      }
      return;
    }

    if (needsOnboarding && !isOnboardingRoute) {
      router.replace('/(auth)/onboarding');
      return;
    }

    if (!needsOnboarding && inAuthGroup) {
      router.replace('/');
    }
  }, [authStatus, hasHydrated, inAuthGroup, isAuthenticated, isOnboardingRoute, needsOnboarding]);

  return (
    <ErrorBoundary>
      {!hasHydrated || authStatus === 'loading' ? (
        <View style={styles.loadingScreen} testID="loading-screen">
          <LoadingSpinner />
        </View>
      ) : (
        <>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: theme.colors.background },
              headerTintColor: theme.colors.textPrimary,
              contentStyle: { backgroundColor: theme.colors.background }
            }}
          >
            <Stack.Screen name="(auth)" options={{ headerShown: false }} />
            <Stack.Screen name="index" options={{ title: t('appName') }} />
            <Stack.Screen name="mode-select/[artistId]" options={{ title: t('modeSelectTitle') }} />
            <Stack.Screen name="history/[artistId]" options={{ title: t('historyScreenTitle') }} />
            <Stack.Screen name="chat/[conversationId]" options={{ title: t('chatTitle') }} />
            <Stack.Screen name="settings/index" options={{ title: t('settingsTitle') }} />
          </Stack>
        </>
      )}
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    backgroundColor: theme.colors.background,
    justifyContent: 'center',
    alignItems: 'center'
  }
});
