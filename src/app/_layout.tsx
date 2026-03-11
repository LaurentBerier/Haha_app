import { Stack, router, usePathname, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Image, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { BrandMark } from '../components/common/BrandMark';
import { ErrorBoundary } from '../components/common/ErrorBoundary';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { ToastProvider } from '../components/common/ToastProvider';
import { useAuth } from '../hooks/useAuth';
import { useStorePersistence } from '../hooks/useStorePersistence';
import { t } from '../i18n';
import { signOut } from '../services/authService';
import { useStore } from '../store/useStore';
import { theme } from '../theme';
import { E2E_AUTH_BYPASS } from '../config/env';
import cleanBackground from '../../assets/branding/Clean_BG.jpg';
import neonTitleMark from '../../assets/branding/logo-neon-Trans.png';

type AccountMenuRoute = '/settings' | '/settings/edit-profile' | '/settings/subscription' | '/stats';
const WEB_BACKGROUND_MIN_HEIGHT_VH = 100;
const WEB_BACKGROUND_MAX_HEIGHT_VH = 170;

export default function RootLayout() {
  useStorePersistence();
  const hasHydrated = useStore((state) => state.hasHydrated);
  const language = useStore((state) => state.language);
  const clearSession = useStore((state) => state.clearSession);
  const { authStatus, isAuthenticated, userProfile } = useAuth();
  const segments = useSegments();
  const pathname = usePathname();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const inAuthGroup = segments[0] === '(auth)';
  const isAuthCallbackRoute = segments[0] === 'auth' && segments[1] === 'callback';
  const isOnboardingRoute = segments[1] === 'onboarding';
  const needsOnboarding =
    isAuthenticated && userProfile ? !userProfile.onboardingCompleted && !userProfile.onboardingSkipped : false;
  const showAccountMenu = isAuthenticated && !inAuthGroup;

  const accountMenuItems = [
    { label: t('settingsEditProfile'), route: '/settings/edit-profile' as const },
    { label: t('settingsStats'), route: '/stats' as const },
    { label: t('settingsTitle'), route: '/settings' as const },
    { label: t('settingsSubscription'), route: '/settings/subscription' as const }
  ];
  const authMenuLabel = isAuthenticated
    ? t('settingsLogout')
    : segments[1] === 'login'
      ? t('menuAuthSignUp')
      : t('menuAuthSignIn');
  const webBackgroundUri = (cleanBackground as { uri?: string }).uri;
  const imageAspectRatio = 1200 / 1753;
  const viewportAspectRatio = viewportWidth / Math.max(viewportHeight, 1);
  const requiredFillHeightVh = (viewportAspectRatio / imageAspectRatio) * 100;
  const webBackgroundHeightVh = Math.max(
    WEB_BACKGROUND_MIN_HEIGHT_VH,
    Math.min(WEB_BACKGROUND_MAX_HEIGHT_VH, requiredFillHeightVh)
  );
  const webBackgroundSize = `auto ${webBackgroundHeightVh.toFixed(1)}vh`;
  const headerContentMaxWidth = 680;
  const headerHorizontalInset =
    Platform.OS === 'web'
      ? Math.max(theme.spacing.md, (viewportWidth - headerContentMaxWidth) / 2 + theme.spacing.md)
      : theme.spacing.md;
  const nativeBackgroundHeight = Math.max(viewportHeight, 1);
  const nativeBackgroundWidth = nativeBackgroundHeight * imageAspectRatio;
  const nativeBackgroundLeft = (viewportWidth - nativeBackgroundWidth) / 2;
  const backgroundSource =
    Platform.OS === 'web' && webBackgroundUri
      ? { uri: webBackgroundUri }
      : cleanBackground;

  const toggleAccountMenu = () => {
    setIsAccountMenuOpen((current) => !current);
  };

  const closeAccountMenu = () => {
    setIsAccountMenuOpen(false);
  };

  const navigateFromAccountMenu = (route: AccountMenuRoute) => {
    closeAccountMenu();
    requestAnimationFrame(() => {
      router.push(route);
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
      if (E2E_AUTH_BYPASS) {
        if (inAuthGroup) {
          router.replace('/');
        }
        return;
      }

      if ((!inAuthGroup && !isAuthCallbackRoute) || isOnboardingRoute) {
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
  }, [authStatus, hasHydrated, inAuthGroup, isAuthCallbackRoute, isAuthenticated, isOnboardingRoute, needsOnboarding]);

  useEffect(() => {
    if (!showAccountMenu && isAccountMenuOpen) {
      setIsAccountMenuOpen(false);
    }
  }, [isAccountMenuOpen, showAccountMenu]);

  useEffect(() => {
    setIsAccountMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !webBackgroundUri || typeof document === 'undefined') {
      return;
    }

    const { body, documentElement } = document;
    const previous = {
      bodyImage: body.style.backgroundImage,
      bodySize: body.style.backgroundSize,
      bodyPosition: body.style.backgroundPosition,
      bodyRepeat: body.style.backgroundRepeat,
      bodyAttachment: body.style.backgroundAttachment,
      bodyColor: body.style.backgroundColor,
      htmlColor: documentElement.style.backgroundColor
    };
    const styleId = 'haha-web-bg-runtime-fix';
    const existingStyle = document.getElementById(styleId);
    const styleElement = existingStyle ?? document.createElement('style');
    styleElement.id = styleId;
    styleElement.textContent =
      '#root div[style*="background-color: rgb(242, 242, 242)"]{background-color:transparent !important;}' +
      '#root [role="button"],#root [tabindex="0"]{cursor:pointer;transition:filter .14s ease, transform .14s ease, box-shadow .14s ease;}' +
      '#root [role="button"]:hover,#root [tabindex="0"]:hover{filter:brightness(1.08);}';
    if (!existingStyle) {
      document.head.appendChild(styleElement);
    }

    body.style.backgroundImage = `url("${webBackgroundUri}")`;
    body.style.backgroundSize = webBackgroundSize;
    body.style.backgroundPosition = 'center center';
    body.style.backgroundRepeat = 'no-repeat';
    body.style.backgroundAttachment = 'fixed';
    body.style.backgroundColor = '#090D16';
    documentElement.style.backgroundColor = '#090D16';

    return () => {
      body.style.backgroundImage = previous.bodyImage;
      body.style.backgroundSize = previous.bodySize;
      body.style.backgroundPosition = previous.bodyPosition;
      body.style.backgroundRepeat = previous.bodyRepeat;
      body.style.backgroundAttachment = previous.bodyAttachment;
      body.style.backgroundColor = previous.bodyColor;
      documentElement.style.backgroundColor = previous.htmlColor;
      if (!existingStyle && styleElement.parentNode) {
        styleElement.parentNode.removeChild(styleElement);
      }
    };
  }, [webBackgroundSize, webBackgroundUri]);

  return (
    <ErrorBoundary>
      <ToastProvider>
        <View style={styles.appShell}>
          {Platform.OS !== 'web' ? (
            <Image
              source={backgroundSource}
              style={[
                styles.backgroundImageNative,
                {
                  width: nativeBackgroundWidth,
                  height: nativeBackgroundHeight,
                  left: nativeBackgroundLeft
                }
              ]}
              resizeMode="cover"
            />
          ) : null}
          <View style={styles.backgroundOverlay} pointerEvents="none" />
          {!hasHydrated || authStatus === 'loading' ? (
            <View style={styles.loadingScreen} testID="loading-screen">
              <LoadingSpinner />
            </View>
          ) : (
            <>
              <StatusBar style="light" />
              <Stack
                key={language}
                screenOptions={{
                  headerStyle: {
                    backgroundColor: theme.colors.background
                  },
                  headerTintColor: theme.colors.textPrimary,
                  contentStyle: { backgroundColor: theme.colors.background },
                  headerTitleAlign: 'center',
                  headerTitleStyle: styles.headerTitle,
                  headerTitle: showAccountMenu
                    ? () => <Image source={neonTitleMark} style={styles.headerTitleLogo} resizeMode="contain" />
                    : undefined,
                  headerShadowVisible: false,
                  headerLeft: () =>
                    showAccountMenu ? (
                      <Pressable
                        onPress={navigateHome}
                        style={({ hovered, pressed }) => [
                          styles.headerBrandButton,
                          { marginLeft: headerHorizontalInset },
                          hovered ? styles.headerHovered : null,
                          pressed ? styles.headerPressed : null
                        ]}
                        accessibilityRole="button"
                        testID="header-home-button"
                      >
                        <BrandMark compact />
                      </Pressable>
                    ) : null,
                  headerRight: () =>
                    showAccountMenu ? (
                      <Pressable
                        onPress={toggleAccountMenu}
                        style={({ hovered, pressed }) => [
                          styles.headerMenuButton,
                          { marginRight: headerHorizontalInset },
                          hovered ? styles.headerHovered : null,
                          pressed ? styles.headerPressed : null
                        ]}
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
                <Stack.Screen name="index" options={{ title: '' }} />
                <Stack.Screen
                  name="mode-select/[artistId]/index"
                  options={{
                    title: t('modeSelectTitle'),
                    animation: 'fade_from_bottom',
                    animationDuration: 220
                  }}
                />
                <Stack.Screen
                  name="mode-select/[artistId]/[categoryId]"
                  options={{
                    title: t('modeSelectTitle'),
                    animation: 'slide_from_right',
                    animationDuration: 240
                  }}
                />
                <Stack.Screen
                  name="history/[artistId]"
                  options={{
                    title: t('historyScreenTitle'),
                    animation: 'slide_from_right',
                    animationDuration: 260
                  }}
                />
                <Stack.Screen
                  name="chat/[conversationId]"
                  options={{
                    title: t('chatTitle'),
                    animation: 'slide_from_right',
                    animationDuration: 280,
                    gestureEnabled: true
                  }}
                />
                <Stack.Screen
                  name="games/[artistId]/index"
                  options={{
                    title: t('gamesSection'),
                    animation: 'slide_from_right',
                    animationDuration: 240
                  }}
                />
                <Stack.Screen
                  name="games/[artistId]/impro-chain"
                  options={{
                    title: t('gameImproTitle'),
                    animation: 'slide_from_right',
                    animationDuration: 260
                  }}
                />
                <Stack.Screen
                  name="games/[artistId]/vrai-ou-invente"
                  options={{
                    title: t('gameVraiInventeTitle'),
                    animation: 'slide_from_right',
                    animationDuration: 260
                  }}
                />
                <Stack.Screen name="settings/index" options={{ title: t('settingsTitle') }} />
                <Stack.Screen name="settings/edit-profile" options={{ title: t('settingsEditProfile') }} />
                <Stack.Screen name="settings/subscription" options={{ title: t('settingsSubscription') }} />
                <Stack.Screen name="stats/index" options={{ title: t('settingsStats') }} />
              </Stack>
              {isAccountMenuOpen ? (
                <View style={styles.menuOverlay}>
                  <Pressable style={styles.menuBackdrop} onPress={closeAccountMenu} testID="account-menu-backdrop" />
                  <View style={[styles.menuPanel, Platform.OS === 'web' ? { right: headerHorizontalInset } : null]}>
                    <Text style={styles.menuTitle}>{t('settingsAccount')}</Text>
                    {accountMenuItems.map((item) => (
                      <Pressable
                        key={item.route}
                        onPress={() => navigateFromAccountMenu(item.route)}
                        style={({ hovered, pressed }) => [
                          styles.menuItem,
                          hovered ? styles.menuItemHovered : null,
                          pressed ? styles.menuItemPressed : null
                        ]}
                        accessibilityRole="button"
                        testID={`account-menu-item-${item.route.replace(/\//g, '-')}`}
                      >
                        <Text style={styles.menuItemLabel}>{item.label}</Text>
                      </Pressable>
                    ))}
                    <View style={styles.menuDivider} />
                    <Pressable
                      onPress={() => void handleAuthMenuAction()}
                      style={({ hovered, pressed }) => [
                        styles.menuItem,
                        hovered ? styles.menuItemHovered : null,
                        pressed ? styles.menuItemPressed : null,
                        isAuthenticated ? styles.menuItemDestructive : null
                      ]}
                      accessibilityRole="button"
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
        </View>
      </ToastProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  appShell: {
    flex: 1,
    backgroundColor: 'transparent'
  },
  backgroundImage: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.96
  },
  backgroundImageNative: {
    position: 'absolute',
    top: 0,
    opacity: 0.96
  },
  backgroundOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(4, 9, 18, 0.02)'
  },
  loadingScreen: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center'
  },
  headerMenuButton: {
    borderWidth: 1,
    borderColor: theme.colors.neonBlueSoft,
    backgroundColor: theme.colors.surfaceSunken,
    borderRadius: 12,
    width: 44,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    shadowColor: theme.colors.neonBlue,
    shadowOpacity: 0.34,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4
  },
  headerBrandButton: {
    borderWidth: 1,
    borderColor: theme.colors.neonBlueSoft,
    backgroundColor: theme.colors.surfaceSunken,
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 8,
    shadowColor: theme.colors.neonBlue,
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4
  },
  headerPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }]
  },
  headerHovered: {
    borderColor: theme.colors.neonBlue,
    shadowColor: theme.colors.neonBlue,
    shadowOpacity: 0.46,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 7
  },
  headerTitle: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '700'
  },
  headerTitleLogo: {
    width: 176,
    height: 38
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
  menuItemHovered: {
    borderColor: theme.colors.neonBlue,
    shadowColor: theme.colors.neonBlue,
    shadowOpacity: 0.34,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 5
  },
  menuItemPressed: {
    opacity: 0.94
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
