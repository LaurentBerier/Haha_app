import { Stack, router, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Platform, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { BrandMark } from '../components/common/BrandMark';
import { ErrorBoundary } from '../components/common/ErrorBoundary';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { useAuth } from '../hooks/useAuth';
import { useStorePersistence } from '../hooks/useStorePersistence';
import { t } from '../i18n';
import { signOut } from '../services/authService';
import { useStore } from '../store/useStore';
import { theme } from '../theme';

type AccountMenuRoute = '/settings' | '/settings/edit-profile' | '/settings/subscription';

export default function RootLayout() {
  useStorePersistence();
  const hasHydrated = useStore((state) => state.hasHydrated);
  const language = useStore((state) => state.language);
  const displayMode = useStore((state) => state.displayMode);
  const clearSession = useStore((state) => state.clearSession);
  const { authStatus, isAuthenticated, userProfile } = useAuth();
  const segments = useSegments();
  const systemColorScheme = useColorScheme();
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const inAuthGroup = segments[0] === '(auth)';
  const isOnboardingRoute = segments[1] === 'onboarding';
  const needsOnboarding =
    isAuthenticated && userProfile ? !userProfile.onboardingCompleted && !userProfile.onboardingSkipped : false;
  const showAccountMenu = isAuthenticated && !inAuthGroup;

  const accountMenuItems = [
    { label: t('settingsTitle'), route: '/settings' as const },
    { label: t('settingsEditProfile'), route: '/settings/edit-profile' as const },
    { label: t('settingsSubscription'), route: '/settings/subscription' as const }
  ];
  const authMenuLabel = isAuthenticated
    ? t('settingsLogout')
    : segments[1] === 'login'
      ? t('menuAuthSignUp')
      : t('menuAuthSignIn');
  const effectiveDisplayMode = displayMode === 'system' ? (systemColorScheme === 'light' ? 'light' : 'dark') : displayMode;

  const toggleAccountMenu = () => {
    setIsAccountMenuOpen((current) => !current);
  };

  const closeAccountMenu = () => {
    setIsAccountMenuOpen(false);
  };

  const navigateFromAccountMenu = (route: AccountMenuRoute) => {
    closeAccountMenu();
    requestAnimationFrame(() => {
      router.replace(route);
    });
  };

  const navigateHome = () => {
    closeAccountMenu();
    router.replace('/');
  };

  const handleAuthMenuAction = async () => {
    closeAccountMenu();
    if (isAuthenticated) {
      try {
        await signOut();
      } catch (error) {
        console.error('[RootLayout] signOut failed', error);
      } finally {
        clearSession();
        router.replace('/(auth)/login');
      }
      return;
    }

    if (segments[1] === 'login') {
      router.replace('/(auth)/signup');
      return;
    }

    router.replace('/(auth)/login');
  };

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

  useEffect(() => {
    if (!showAccountMenu && isAccountMenuOpen) {
      setIsAccountMenuOpen(false);
    }
  }, [isAccountMenuOpen, showAccountMenu]);

  useEffect(() => {
    if (isAccountMenuOpen) {
      setIsAccountMenuOpen(false);
    }
  }, [isAccountMenuOpen, segments]);

  return (
    <ErrorBoundary>
      {!hasHydrated || authStatus === 'loading' ? (
        <View style={styles.loadingScreen} testID="loading-screen">
          <LoadingSpinner />
        </View>
      ) : (
        <>
          <StatusBar style={effectiveDisplayMode === 'light' ? 'dark' : 'light'} />
          <Stack
            key={language}
            screenOptions={{
              headerStyle: {
                backgroundColor: theme.colors.background
              },
              headerTintColor: theme.colors.textPrimary,
              contentStyle: { backgroundColor: theme.colors.background },
              headerTitleAlign: 'left',
              headerTitle: showAccountMenu ? '' : undefined,
              headerShadowVisible: false,
              headerLeft: () =>
                showAccountMenu ? (
                  <Pressable
                    onPress={navigateHome}
                    style={styles.headerBrandButton}
                    accessibilityRole="button"
                    testID="header-home-button"
                  >
                    <BrandMark compact title={t('appName')} />
                  </Pressable>
                ) : null,
              headerRight: () =>
                showAccountMenu ? (
                  <Pressable
                    onPress={toggleAccountMenu}
                    style={styles.headerMenuButton}
                    accessibilityRole="button"
                    testID="header-menu-button"
                  >
                    <View style={styles.menuBar} />
                    <View style={styles.menuBar} />
                    <View style={styles.menuBar} />
                  </Pressable>
                ) : null
            }}
          >
            <Stack.Screen name="(auth)" options={{ headerShown: false }} />
            <Stack.Screen name="index" options={{ title: t('appName') }} />
            <Stack.Screen name="mode-select/[artistId]" options={{ title: t('modeSelectTitle') }} />
            <Stack.Screen name="history/[artistId]" options={{ title: t('historyScreenTitle') }} />
            <Stack.Screen name="chat/[conversationId]" options={{ title: t('chatTitle') }} />
            <Stack.Screen name="settings/index" options={{ title: t('settingsTitle') }} />
            <Stack.Screen name="settings/edit-profile" options={{ title: t('settingsEditProfile') }} />
            <Stack.Screen name="settings/subscription" options={{ title: t('settingsSubscription') }} />
          </Stack>
          {isAccountMenuOpen ? (
            <View style={styles.menuOverlay}>
              <Pressable style={styles.menuBackdrop} onPress={closeAccountMenu} testID="account-menu-backdrop" />
              <View style={styles.menuPanel}>
                <Text style={styles.menuTitle}>{t('settingsAccount')}</Text>
                {accountMenuItems.map((item) => (
                  <Pressable
                    key={item.route}
                    onPress={() => navigateFromAccountMenu(item.route)}
                    style={styles.menuItem}
                    testID={`account-menu-item-${item.route.replace(/\//g, '-')}`}
                  >
                    <Text style={styles.menuItemLabel}>{item.label}</Text>
                  </Pressable>
                ))}
                <View style={styles.menuDivider} />
                <Pressable
                  onPress={() => void handleAuthMenuAction()}
                  style={[styles.menuItem, isAuthenticated ? styles.menuItemDestructive : null]}
                  testID="account-menu-auth-action"
                >
                  <Text style={[styles.menuItemLabel, isAuthenticated ? styles.menuItemLabelDestructive : null]}>
                    {authMenuLabel}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}
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
  },
  headerMenuButton: {
    borderWidth: 1,
    borderColor: theme.colors.surfaceButton,
    backgroundColor: theme.colors.surfaceSunken,
    borderRadius: 12,
    width: 44,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4
  },
  headerBrandButton: {
    marginRight: theme.spacing.sm,
    paddingVertical: 4
  },
  menuBar: {
    width: 16,
    height: 2,
    borderRadius: 999,
    backgroundColor: theme.colors.textPrimary
  },
  menuOverlay: {
    position: Platform.OS === 'web' ? 'fixed' : 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 40
  },
  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    zIndex: 1
  },
  menuPanel: {
    position: Platform.OS === 'web' ? 'fixed' : 'absolute',
    top: Platform.OS === 'web' ? 76 : Platform.select({ ios: 96, default: 86 }),
    right: theme.spacing.md,
    minWidth: 230,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.sm,
    gap: theme.spacing.xs,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
    zIndex: 2
  },
  menuTitle: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    paddingHorizontal: theme.spacing.sm,
    paddingTop: 2
  },
  menuItem: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSunken,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm
  },
  menuItemDestructive: {
    borderColor: theme.colors.error
  },
  menuItemLabel: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '600'
  },
  menuItemLabelDestructive: {
    color: theme.colors.error
  },
  menuDivider: {
    height: 1,
    marginVertical: 2,
    backgroundColor: theme.colors.border
  }
});
