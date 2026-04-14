import { Stack, router, usePathname, useSegments } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageStyle,
  useWindowDimensions
} from 'react-native';
import { AccountMenu, type AccountMenuItem } from '../components/layout/AccountMenu';
import { GlobalChatInput } from '../components/layout/GlobalChatInput';
import { BrandMark } from '../components/common/BrandMark';
import { ErrorBoundary } from '../components/common/ErrorBoundary';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { ToastProvider } from '../components/common/ToastProvider';
import { useAuth } from '../hooks/useAuth';
import { useLayoutAuthGate } from '../hooks/useLayoutAuthGate';
import { usePrimaryThreadCloudSync } from '../hooks/usePrimaryThreadCloudSync';
import { useHeaderHorizontalInset } from '../hooks/useHeaderHorizontalInset';
import { useVoiceConversation } from '../hooks/useVoiceConversation';
import { useStorePersistence } from '../hooks/useStorePersistence';
import { t } from '../i18n';
import type { ChatSendPayload } from '../models/ChatSendPayload';
import { signOut } from '../services/authService';
import { planGlobalComposerSend } from '../services/conversationSendOrchestrator';
import { initSentry } from '../services/sentry';
import { useStore } from '../store/useStore';
import { theme } from '../theme';
import { E2E_AUTH_BYPASS } from '../config/env';
import {
  createPersistedRouteSnapshot,
  isModeSelectRoute,
  isRouteEligibleForPersistence,
  LAST_USEFUL_ROUTE_STORAGE_KEY,
  resolveRouteToRestoreFromSnapshot,
  WEB_RESUME_ROUTE_RESTORE_FLAG_KEY
} from '../utils/routeRestore';
import { findConversationById } from '../utils/conversationUtils';
import cleanBackground from '../../assets/branding/Clean_BG.jpg';
import neonTitleMark from '../../assets/branding/logo-simple-neon-Trans.png';

type AccountMenuRoute = '/settings' | '/settings/subscription' | '/stats' | '/admin' | '/history';
const WEB_BACKGROUND_MIN_HEIGHT_VH = 100;
const WEB_BACKGROUND_MAX_HEIGHT_VH = 170;
const WEB_NATIVE_HEADER_EDGE_PADDING = 16;

function resolveArtistIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/(?:mode-select|games)\/([^/]+)/);
  if (!match?.[1]) {
    return null;
  }

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export default function RootLayout() {
  useStorePersistence();
  const hasHydrated = useStore((state) => state.hasHydrated);
  const language = useStore((state) => state.language);
  const selectedArtistId = useStore((state) => state.selectedArtistId);
  const conversations = useStore((state) => state.conversations);
  const activeConversationId = useStore((state) => state.activeConversationId);
  const createConversation = useStore((state) => state.createConversation);
  const setActiveConversation = useStore((state) => state.setActiveConversation);
  const queueChatSendPayload = useStore((state) => state.queueChatSendPayload);
  const conversationModeEnabled = useStore((state) => state.conversationModeEnabled);
  const setConversationModeEnabled = useStore((state) => state.setConversationModeEnabled);
  const clearSession = useStore((state) => state.clearSession);
  const { authStatus, isAuthenticated, isAdmin, userProfile } = useAuth({ bootstrap: true });
  const segments = useSegments();
  const segmentList = segments as readonly string[];
  const pathname = usePathname();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [hasTypedGlobalDraft, setHasTypedGlobalDraft] = useState(false);
  const pendingWebResumeRouteRestoreRef = useRef(false);
  const latestPathnameRef = useRef(pathname);
  const inAuthGroup = segmentList[0] === '(auth)';
  const isAuthCallbackRoute = segmentList[0] === 'auth' && segmentList[1] === 'callback';
  const isOnboardingRoute = segmentList[1] === 'onboarding';
  const isHomeArtistPickerRoute = pathname === '/';
  const isChatRoute = pathname.startsWith('/chat/');
  const isGameRoute = pathname.startsWith('/games/');
  const isModeSelectContextRoute = isModeSelectRoute(pathname);
  const needsOnboarding =
    isAuthenticated && userProfile ? !userProfile.onboardingCompleted && !userProfile.onboardingSkipped : false;
  const showAccountMenu = isAuthenticated && !inAuthGroup;
  const showFloatingHeaderControls = showAccountMenu && !pathname.startsWith('/admin');
  const showGlobalChatInput =
    hasHydrated &&
    authStatus !== 'loading' &&
    isAuthenticated &&
    !inAuthGroup &&
    !isAuthCallbackRoute &&
    !isHomeArtistPickerRoute &&
    !isModeSelectContextRoute &&
    !isGameRoute &&
    !isChatRoute;
  const routeArtistId = resolveArtistIdFromPath(pathname);
  const activeConversationArtistId = useMemo(() => {
    if (!activeConversationId) {
      return null;
    }
    return findConversationById(conversations, activeConversationId)?.artistId ?? null;
  }, [activeConversationId, conversations]);
  const headerNavigationArtistId = useMemo(() => {
    if (routeArtistId) {
      return routeArtistId;
    }

    if (isChatRoute && activeConversationArtistId) {
      return activeConversationArtistId;
    }

    return selectedArtistId ?? null;
  }, [activeConversationArtistId, isChatRoute, routeArtistId, selectedArtistId]);
  const targetArtistId = routeArtistId ?? selectedArtistId;
  const globalInputDisabled = !showGlobalChatInput || !targetArtistId;

  usePrimaryThreadCloudSync({
    pathname,
    hasHydrated
  });

  const accountMenuItems: AccountMenuItem[] = [
    { label: t('settingsProfile'), route: '/settings' as const },
    { label: t('settingsStats'), route: '/stats' as const },
    { label: t('settingsSubscription'), route: '/settings/subscription' as const }
  ];
  accountMenuItems.push({ label: t('historyModeTitle'), route: '/history' });
  if (isAdmin) {
    accountMenuItems.unshift({ label: 'Admin Dashboard', route: '/admin' });
  }
  const authMenuLabel = isAuthenticated ? t('settingsLogout') : t('menuAuthSignIn');
  const webBackgroundUri = (cleanBackground as { uri?: string }).uri;
  const imageAspectRatio = 1200 / 1753;
  const viewportAspectRatio = viewportWidth / Math.max(viewportHeight, 1);
  const requiredFillHeightVh = (viewportAspectRatio / imageAspectRatio) * 100;
  const webBackgroundHeightVh = Math.max(
    WEB_BACKGROUND_MIN_HEIGHT_VH,
    Math.min(WEB_BACKGROUND_MAX_HEIGHT_VH, requiredFillHeightVh)
  );
  const webBackgroundSize = `auto ${webBackgroundHeightVh.toFixed(1)}vh`;
  const headerHorizontalInset = useHeaderHorizontalInset();
  const webHeaderInnerOffset =
    Platform.OS === 'web' ? Math.max(0, headerHorizontalInset - WEB_NATIVE_HEADER_EDGE_PADDING) : 0;
  const accountMenuHorizontalInset =
    Platform.OS === 'web' ? WEB_NATIVE_HEADER_EDGE_PADDING + webHeaderInnerOffset : headerHorizontalInset;
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

  const navigateArtistPicker = () => {
    closeAccountMenu();
    router.replace('/');
  };

  const navigateArtistModeSelect = () => {
    closeAccountMenu();
    const normalizedArtistId = headerNavigationArtistId?.trim();
    if (normalizedArtistId) {
      router.replace({
        pathname: '/mode-select/[artistId]',
        params: { artistId: normalizedArtistId }
      });
      return;
    }
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

    router.replace('/(auth)/login');
  };

  const sendGlobalMessage = useCallback(
    (payload: ChatSendPayload) => {
      const plan = planGlobalComposerSend({
        payload,
        targetArtistId,
        pathname,
        language,
        conversations,
        activeConversationId,
        hasUserMessageInConversation: (conversationId) => {
          const page = useStore.getState().messagesByConversation[conversationId];
          return (page?.messages ?? []).some((message) => message.role === 'user');
        },
        createConversation
      });

      if (plan.action === 'abort' || plan.action === 'launched') {
        return;
      }

      setActiveConversation(plan.conversationId);
      queueChatSendPayload({
        conversationId: plan.conversationId,
        nonce: plan.nonce,
        payload: plan.payload
      });
      router.push({
        pathname: '/chat/[conversationId]',
        params: {
          conversationId: plan.conversationId,
          queuedNonce: plan.nonce
        }
      });
    },
    [
      activeConversationId,
      conversations,
      createConversation,
      language,
      pathname,
      queueChatSendPayload,
      setActiveConversation,
      targetArtistId
    ]
  );

  const {
    isListening: isGlobalConversationListening,
    transcript: globalConversationTranscript,
    error: globalConversationError,
    status: globalConversationStatus,
    hint: globalConversationHint,
    pauseListening: pauseGlobalConversation,
    resumeListening: resumeGlobalConversation
  } = useVoiceConversation({
    enabled:
      showGlobalChatInput &&
      conversationModeEnabled &&
      !globalInputDisabled,
    disabled: globalInputDisabled,
    hasTypedDraft: hasTypedGlobalDraft,
    isPlaying: false,
    onSend: (text) => {
      sendGlobalMessage({ text });
    },
    onStopAudio: () => {},
    language
  });

  useEffect(() => {
    initSentry();
  }, []);

  useLayoutAuthGate({
    hasHydrated,
    authStatus,
    isAuthenticated,
    inAuthGroup,
    isAuthCallbackRoute,
    isOnboardingRoute,
    needsOnboarding,
    e2eAuthBypass: E2E_AUTH_BYPASS
  });

  useEffect(() => {
    if (!showAccountMenu && isAccountMenuOpen) {
      setIsAccountMenuOpen(false);
    }
  }, [isAccountMenuOpen, showAccountMenu]);

  useEffect(() => {
    setIsAccountMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!showGlobalChatInput) {
      setHasTypedGlobalDraft(false);
    }
  }, [showGlobalChatInput]);

  useEffect(() => {
    latestPathnameRef.current = pathname;
  }, [pathname]);

  const getWebSessionStorage = useCallback((): Storage | null => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      return null;
    }
    if (typeof window.sessionStorage === 'undefined') {
      return null;
    }
    return window.sessionStorage;
  }, []);

  const persistWebRouteSnapshot = useCallback((routePathname: string) => {
    const storage = getWebSessionStorage();
    if (!storage) {
      return;
    }

    const snapshot = createPersistedRouteSnapshot(routePathname, Date.now());
    if (!snapshot) {
      return;
    }

    try {
      storage.setItem(LAST_USEFUL_ROUTE_STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // Ignore storage write failures in private browsing or restricted contexts.
    }
  }, [getWebSessionStorage]);

  const markWebResumeRouteRestorePending = useCallback(() => {
    const storage = getWebSessionStorage();
    if (!storage) {
      return;
    }

    pendingWebResumeRouteRestoreRef.current = true;
    try {
      storage.setItem(WEB_RESUME_ROUTE_RESTORE_FLAG_KEY, '1');
    } catch {
      // Ignore storage write failures in private browsing or restricted contexts.
    }
  }, [getWebSessionStorage]);

  const hasPersistedPendingWebResumeRestore = useCallback((): boolean => {
    const storage = getWebSessionStorage();
    if (!storage) {
      return false;
    }

    try {
      return storage.getItem(WEB_RESUME_ROUTE_RESTORE_FLAG_KEY) === '1';
    } catch {
      return false;
    }
  }, [getWebSessionStorage]);

  const clearPersistedPendingWebResumeRestore = useCallback(() => {
    const storage = getWebSessionStorage();
    if (!storage) {
      return;
    }

    try {
      storage.removeItem(WEB_RESUME_ROUTE_RESTORE_FLAG_KEY);
    } catch {
      // Ignore storage access failures in private browsing or restricted contexts.
    }
  }, [getWebSessionStorage]);

  useEffect(() => {
    persistWebRouteSnapshot(pathname);
  }, [pathname, persistWebRouteSnapshot]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    const markPendingResumeRestore = () => {
      if (isRouteEligibleForPersistence(latestPathnameRef.current)) {
        markWebResumeRouteRestorePending();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') {
        return;
      }
      persistWebRouteSnapshot(latestPathnameRef.current);
      markPendingResumeRestore();
    };

    const handlePageHide = () => {
      persistWebRouteSnapshot(latestPathnameRef.current);
      markPendingResumeRestore();
    };

    const handleWindowBlur = () => {
      persistWebRouteSnapshot(latestPathnameRef.current);
      markPendingResumeRestore();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [markWebResumeRouteRestorePending, persistWebRouteSnapshot]);

  useEffect(() => {
    const storage = getWebSessionStorage();
    if (!storage) {
      return;
    }
    const shouldAttemptResumeRestore =
      pendingWebResumeRouteRestoreRef.current || hasPersistedPendingWebResumeRestore();
    if (!shouldAttemptResumeRestore) {
      return;
    }
    if (!hasHydrated || authStatus === 'loading') {
      return;
    }
    if ((!isHomeArtistPickerRoute && !isModeSelectContextRoute) || inAuthGroup || isAuthCallbackRoute) {
      return;
    }

    pendingWebResumeRouteRestoreRef.current = false;
    clearPersistedPendingWebResumeRestore();

    let rawSnapshot: string | null = null;
    try {
      rawSnapshot = storage.getItem(LAST_USEFUL_ROUTE_STORAGE_KEY);
    } catch {
      rawSnapshot = null;
    }

    const restoredRoute = resolveRouteToRestoreFromSnapshot({
      currentPathname: pathname,
      rawSnapshot,
      nowMs: Date.now()
    });
    if (!restoredRoute) {
      return;
    }

    router.replace(restoredRoute as never);
  }, [
    authStatus,
    clearPersistedPendingWebResumeRestore,
    hasHydrated,
    hasPersistedPendingWebResumeRestore,
    inAuthGroup,
    isAuthCallbackRoute,
    isHomeArtistPickerRoute,
    isModeSelectContextRoute,
    getWebSessionStorage,
    pathname
  ]);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      return;
    }
    if (pathname === '/' || isModeSelectContextRoute) {
      return;
    }

    pendingWebResumeRouteRestoreRef.current = false;
    clearPersistedPendingWebResumeRestore();
  }, [clearPersistedPendingWebResumeRestore, isModeSelectContextRoute, pathname]);

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
                  styles.backgroundImageNative as ImageStyle,
                  {
                    width: nativeBackgroundWidth,
                    height: nativeBackgroundHeight,
                    left: nativeBackgroundLeft
                  } as ImageStyle
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
                screenOptions={{
                  headerStyle: {
                    backgroundColor: theme.colors.background
                  },
                  scrollEdgeEffects: { top: 'hidden', bottom: 'hidden', left: 'hidden', right: 'hidden' },
                  headerTintColor: theme.colors.textPrimary,
                  contentStyle: { backgroundColor: theme.colors.background },
                  headerTitleAlign: 'center',
                  headerTitleStyle: {
                    color: theme.colors.textPrimary as string,
                    fontSize: 15,
                    fontWeight: '700'
                  },
                  headerTitle: showAccountMenu
                    ? () => (
                        <Pressable
                          onPress={navigateArtistPicker}
                          style={({ pressed }) => [
                            styles.headerArtistPickerButton,
                            pressed ? styles.headerPressed : null
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel="artist-picker-home-button"
                          testID="header-artist-picker-button"
                        >
                          <Image source={neonTitleMark} style={styles.headerTitleLogo as ImageStyle} resizeMode="contain" />
                        </Pressable>
                      )
                    : undefined,
                  headerShadowVisible: false,
                  headerLeft: showFloatingHeaderControls
                    ? () => (
                        <Pressable
                          onPress={navigateArtistModeSelect}
                          style={({ pressed }) => [
                            styles.headerBrandButton,
                            Platform.OS === 'web' ? { marginLeft: webHeaderInnerOffset } : null,
                            pressed ? styles.headerPressed : null
                          ]}
                          accessibilityRole="button"
                          accessibilityLabel="header-artist-mode-select-button"
                          testID="header-home-button"
                          hitSlop={10}
                        >
                          <BrandMark compact />
                        </Pressable>
                      )
                    : () => null,
                  headerRight: showFloatingHeaderControls
                    ? () => (
                        <Pressable
                          onPress={toggleAccountMenu}
                          style={({ pressed }) => [
                            styles.headerMenuButton,
                            Platform.OS === 'web' ? { marginRight: webHeaderInnerOffset } : null,
                            pressed ? styles.headerPressed : null
                          ]}
                          accessibilityRole="button"
                          testID="header-menu-button"
                          hitSlop={10}
                        >
                          <View style={styles.menuBarsStack}>
                            <View style={styles.menuBar} />
                            <View style={styles.menuBar} />
                            <View style={styles.menuBar} />
                          </View>
                        </Pressable>
                      )
                    : () => null
                }}
              >
                <Stack.Screen name="(auth)" options={{ headerShown: false }} />
                <Stack.Screen name="index" options={{ title: '' }} />
                <Stack.Screen
                  name="mode-select/[artistId]/index"
                  options={{
                    title: '',
                    headerBackVisible: false,
                    animation: 'fade_from_bottom',
                    animationDuration: 220
                  }}
                />
                <Stack.Screen
                  name="mode-select/[artistId]/[categoryId]"
                  options={{
                    title: '',
                    headerBackVisible: false,
                    animation: 'slide_from_right',
                    animationDuration: 240
                  }}
                />
                <Stack.Screen
                  name="history/index"
                  options={{
                    title: t('historyModeTitle'),
                    animation: 'slide_from_right',
                    animationDuration: 260
                  }}
                />
                <Stack.Screen
                  name="chat/[conversationId]"
                  options={{
                    title: t('chatTitle'),
                    headerBackVisible: false,
                    animation: 'slide_from_right',
                    animationDuration: 280,
                    gestureEnabled: true
                  }}
                />
                <Stack.Screen
                  name="games/[artistId]/index"
                  options={{
                    title: t('gamesSection'),
                    headerBackVisible: false,
                    animation: 'slide_from_right',
                    animationDuration: 240
                  }}
                />
                <Stack.Screen
                  name="games/[artistId]/impro-chain"
                  options={{
                    title: t('gameImproTitle'),
                    headerBackVisible: false,
                    animation: 'slide_from_right',
                    animationDuration: 260
                  }}
                />
                <Stack.Screen
                  name="games/[artistId]/vrai-ou-invente"
                  options={{
                    title: t('gameVraiInventeTitle'),
                    headerBackVisible: false,
                    animation: 'slide_from_right',
                    animationDuration: 260
                  }}
                />
                <Stack.Screen
                  name="games/[artistId]/tarot-cathy"
                  options={{
                    title: t('gameTarotTitle'),
                    headerBackVisible: false,
                    animation: 'slide_from_right',
                    animationDuration: 260
                  }}
                />
                <Stack.Screen name="settings/index" options={{ title: t('settingsTitle') }} />
                <Stack.Screen name="settings/edit-profile" options={{ title: t('settingsEditProfile') }} />
                <Stack.Screen name="settings/subscription" options={{ title: t('settingsSubscription') }} />
                <Stack.Screen name="stats/index" options={{ title: t('settingsStats') }} />
                <Stack.Screen name="admin" options={{ headerShown: false }} />
              </Stack>
              <GlobalChatInput
                visible={showGlobalChatInput}
                disabled={globalInputDisabled}
                conversationModeEnabled={conversationModeEnabled}
                isListening={isGlobalConversationListening}
                transcript={globalConversationTranscript}
                error={globalConversationError}
                status={globalConversationStatus}
                hint={globalConversationHint}
                onSend={sendGlobalMessage}
                onEnableConversationMode={() => {
                  setConversationModeEnabled(true);
                }}
                onPauseListening={() => {
                  setConversationModeEnabled(false);
                  pauseGlobalConversation();
                }}
                onResumeListening={resumeGlobalConversation}
                onTypingStateChange={setHasTypedGlobalDraft}
              />
              <AccountMenu
                isOpen={isAccountMenuOpen}
                isAuthenticated={isAuthenticated}
                authMenuLabel={authMenuLabel}
                items={accountMenuItems}
                headerHorizontalInset={accountMenuHorizontalInset}
                onClose={closeAccountMenu}
                onNavigate={(route) => {
                  navigateFromAccountMenu(route as AccountMenuRoute);
                }}
                onAuthAction={() => {
                  void handleAuthMenuAction();
                }}
              />
              {/* #region agent log */}
              {Platform.OS === 'web' ? (
                <Pressable
                  onPress={() => {
                    try {
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      const logs = (window as any).__dbg ?? [];
                      const text = JSON.stringify(logs, null, 1);
                      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                        navigator.clipboard.writeText(text).then(() => {
                          alert(`Copied ${logs.length} debug logs to clipboard`);
                        }).catch(() => {
                          prompt('Copy these logs:', text.slice(0, 4000));
                        });
                      } else {
                        prompt('Copy these logs:', text.slice(0, 4000));
                      }
                    } catch { alert('No logs'); }
                  }}
                  style={{ position: 'absolute', bottom: 4, left: 4, zIndex: 99999, backgroundColor: 'rgba(255,0,0,0.7)', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4 }}
                >
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>DBG</Text>
                </Pressable>
              ) : null}
              {/* #endregion */}
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
  globalInputDock: {
    width: '100%',
    paddingBottom: Platform.OS === 'ios' ? theme.spacing.sm : theme.spacing.xs
  },
  globalInputContent: {
    width: '100%',
    maxWidth: 784,
    alignSelf: 'center'
  },
  headerMenuButton: {
    borderWidth: 0,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    width: 42,
    height: 42,
    padding: 0,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0
  },
  headerBrandButton: {
    borderWidth: 0,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    width: 42,
    height: 42,
    padding: 0,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0
  },
  menuBarsStack: {
    width: 20,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4
  },
  headerPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }]
  },
  headerArtistPickerButton: {
    backgroundColor: 'transparent',
    borderRadius: 999,
    width: 160,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible'
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
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999
  },
  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    zIndex: 1
  },
  menuPanel: {
    position: 'absolute',
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
