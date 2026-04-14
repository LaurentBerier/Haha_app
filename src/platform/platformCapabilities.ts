import { Platform } from 'react-native';

const MOBILE_WEB_UA_PATTERN = /iphone|ipad|ipod|android/i;
const IOS_MOBILE_WEB_UA_PATTERN = /iphone|ipad|ipod/i;
const IPADOS_DESKTOP_UA_PATTERN = /macintosh/i;
const MOBILE_HINT_UA_PATTERN = /mobile/i;

/**
 * True when running in React Native Web (browser).
 */
export function isReactNativeWeb(): boolean {
  return Platform.OS === 'web';
}

/**
 * True for iOS or Android native app (not web).
 */
export function isNativeMobileApp(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

/**
 * Best-effort: mobile browser session in RN Web (not desktop browser).
 * Used for magic-link → native app handoff.
 */
export function isMobileWebUserAgent(userAgent: string | undefined | null): boolean {
  if (!userAgent || typeof userAgent !== 'string') {
    return false;
  }
  return MOBILE_WEB_UA_PATTERN.test(userAgent.toLowerCase());
}

/**
 * Best-effort: iOS/iPadOS browser session in RN Web (Safari / WKWebView style UA).
 */
export function isIosMobileWebUserAgent(userAgent: string | undefined | null): boolean {
  if (!userAgent || typeof userAgent !== 'string') {
    return false;
  }

  const normalized = userAgent.toLowerCase();
  if (IOS_MOBILE_WEB_UA_PATTERN.test(normalized)) {
    return true;
  }

  // iPadOS desktop-class Safari can report "Macintosh" with a "Mobile" hint.
  return IPADOS_DESKTOP_UA_PATTERN.test(normalized) && MOBILE_HINT_UA_PATTERN.test(normalized);
}

export function getNavigatorUserAgent(): string | null {
  if (typeof navigator === 'undefined' || typeof navigator.userAgent !== 'string') {
    return null;
  }
  return navigator.userAgent;
}

/**
 * True when running in iOS/iPadOS mobile browser context (RN Web only).
 */
export function isIosMobileWebRuntime(): boolean {
  if (!isReactNativeWeb()) {
    return false;
  }

  return isIosMobileWebUserAgent(getNavigatorUserAgent());
}

export type AuthNativeHandoffDeps = {
  hasAuthPayload: (url: URL) => boolean;
  sessionStorageGetItem: (key: string) => string | null;
  sessionStorageSetItem: (key: string, value: string) => void;
};

const HANDOFF_STORAGE_KEY = 'haha-auth-native-handoff-url';

/**
 * Whether to redirect the web callback URL into the native app scheme (mobile browser only).
 */
export function shouldTryAuthNativeHandoff(
  webUrl: URL,
  deps: Pick<AuthNativeHandoffDeps, 'hasAuthPayload' | 'sessionStorageGetItem'>
): boolean {
  if (!isReactNativeWeb() || typeof window === 'undefined') {
    return false;
  }

  if (!isMobileWebUserAgent(getNavigatorUserAgent())) {
    return false;
  }

  if (!deps.hasAuthPayload(webUrl)) {
    return false;
  }

  if (webUrl.searchParams.get('opened_in_app') === '1') {
    return false;
  }

  try {
    const previous = deps.sessionStorageGetItem(HANDOFF_STORAGE_KEY);
    if (previous === webUrl.href) {
      return false;
    }
  } catch {
    // Ignore unavailable session storage.
  }

  return true;
}

export function rememberAuthNativeHandoffUrl(href: string, setItem: (key: string, value: string) => void): void {
  try {
    setItem(HANDOFF_STORAGE_KEY, href);
  } catch {
    // Ignore.
  }
}
