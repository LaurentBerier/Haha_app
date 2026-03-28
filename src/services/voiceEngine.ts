import { Platform } from 'react-native';
import { fetchAndCacheVoice, type FetchVoiceOptions } from './ttsService';

type Listener = { remove: () => void };
type NativeSpeechRecognitionEvent = {
  results?: Array<{ transcript?: string }>;
  message?: string;
  error?: string;
};
type SpeechRecognitionModule = {
  requestPermissionsAsync: () => Promise<{ granted: boolean }>;
  addListener: (
    eventName: 'result' | 'error' | 'end',
    callback: (event?: NativeSpeechRecognitionEvent) => void
  ) => Listener;
  start: (options: {
    lang: string;
    interimResults: boolean;
    maxAlternatives: number;
    continuous: boolean;
    addsPunctuation: boolean;
  }) => void;
  stop: () => void;
  isRecognitionAvailable?: () => boolean;
};

interface WebSpeechRecognitionResultItem {
  transcript?: string;
}

interface WebSpeechRecognitionResultList {
  length: number;
  [index: number]: WebSpeechRecognitionResultItem;
}

interface WebSpeechRecognitionEvent {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: WebSpeechRecognitionResultList;
  };
}

interface WebSpeechRecognitionErrorEvent {
  error?: string;
  message?: string;
}

interface WebSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: WebSpeechRecognitionEvent) => void) | null;
  onerror: ((event: WebSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
}

type WebSpeechRecognitionCtor = new () => WebSpeechRecognition;
const WEB_SESSION_MAX_RESTARTS = 3;

let cachedModule: SpeechRecognitionModule | null | undefined;
let hasLoggedMissingNativeSpeechModule = false;
let nextVoiceSessionId = 1;
let activeVoiceSessionId: number | null = null;
let activeNativeListeners: Listener[] = [];
let activeWebRecognition: WebSpeechRecognition | null = null;

export type VoiceSessionEndReason =
  | 'stopped'
  | 'unsupported'
  | 'permission'
  | 'no_speech'
  | 'aborted'
  | 'ended_unexpectedly'
  | 'transient'
  | 'error';

export interface VoiceListeningResultEvent {
  sessionId: number;
  transcript: string;
}

export interface VoiceListeningEndEvent {
  sessionId: number;
  reason: VoiceSessionEndReason;
  message: string | null;
}

export interface VoiceListeningSession {
  id: number;
  stop: () => void;
}

export interface StartVoiceListeningSessionOptions {
  locale: string;
  fallbackLocale?: string;
  onResult: (event: VoiceListeningResultEvent) => void;
  onEnd: (event: VoiceListeningEndEvent) => void;
}

const DEFAULT_STT_LOCALE = 'fr-CA';

const STT_DEFAULT_LOCALE_BY_PREFIX: Record<string, string> = {
  ar: 'ar-SA',
  de: 'de-DE',
  en: 'en-CA',
  es: 'es-ES',
  fr: 'fr-CA',
  it: 'it-IT',
  ja: 'ja-JP',
  ko: 'ko-KR',
  nl: 'nl-NL',
  pt: 'pt-BR',
  ru: 'ru-RU',
  tr: 'tr-TR',
  zh: 'zh-CN'
};

function hasRequiredNativeSpeechModuleApi(value: unknown): value is SpeechRecognitionModule {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<SpeechRecognitionModule>;
  return (
    typeof candidate.requestPermissionsAsync === 'function' &&
    typeof candidate.addListener === 'function' &&
    typeof candidate.start === 'function' &&
    typeof candidate.stop === 'function'
  );
}

function getSpeechRecognitionModule(): SpeechRecognitionModule | null {
  if (cachedModule !== undefined) {
    return cachedModule;
  }

  if (Platform.OS === 'web') {
    cachedModule = null;
    return cachedModule;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require('expo-speech-recognition') as { ExpoSpeechRecognitionModule?: unknown };
    cachedModule = hasRequiredNativeSpeechModuleApi(loaded?.ExpoSpeechRecognitionModule)
      ? loaded.ExpoSpeechRecognitionModule
      : null;
    if (!cachedModule && !hasLoggedMissingNativeSpeechModule) {
      hasLoggedMissingNativeSpeechModule = true;
      console.warn('[voiceEngine] ExpoSpeechRecognition native module is missing in this build.');
    }
  } catch (error) {
    cachedModule = null;
    if (!hasLoggedMissingNativeSpeechModule) {
      hasLoggedMissingNativeSpeechModule = true;
      const reason =
        error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown error';
      console.warn('[voiceEngine] Unable to load expo-speech-recognition module:', reason);
    }
  }

  return cachedModule;
}

function clearNativeListeners(): void {
  activeNativeListeners.forEach((listener) => listener.remove());
  activeNativeListeners = [];
}

function getWebSpeechRecognitionCtor(): WebSpeechRecognitionCtor | null {
  if (Platform.OS !== 'web') {
    return null;
  }

  const scope = globalThis as {
    SpeechRecognition?: WebSpeechRecognitionCtor;
    webkitSpeechRecognition?: WebSpeechRecognitionCtor;
  };

  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

function normalizeVoiceErrorMessage(rawMessage: string | null | undefined): string | null {
  if (typeof rawMessage !== 'string') {
    return null;
  }

  const normalized = rawMessage.trim();
  return normalized ? normalized : null;
}

function normalizeLocaleCandidate(locale: string | null | undefined): string | null {
  if (typeof locale !== 'string') {
    return null;
  }

  const trimmed = locale.trim().replace(/_/g, '-');
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^([a-zA-Z]{2,3})(?:-([a-zA-Z]{2}|\d{3}|[a-zA-Z]{4}))?(?:-([a-zA-Z]{2}|\d{3}))?/);
  if (!match) {
    return null;
  }

  const language = match[1]?.toLowerCase();
  if (!language) {
    return null;
  }

  const second = match[2] ?? '';
  const third = match[3] ?? '';
  const region = /^[a-zA-Z]{2}$/.test(second) || /^[0-9]{3}$/.test(second)
    ? second.toUpperCase()
    : /^[a-zA-Z]{2}$/.test(third) || /^[0-9]{3}$/.test(third)
      ? third.toUpperCase()
      : null;

  if (region) {
    return `${language}-${region}`;
  }

  return STT_DEFAULT_LOCALE_BY_PREFIX[language] ?? language;
}

function resolveSttLocales(locale: string, fallbackLocale?: string): { primary: string; fallback: string | null } {
  const normalizedPrimary = normalizeLocaleCandidate(locale) ?? DEFAULT_STT_LOCALE;
  const normalizedFallback = normalizeLocaleCandidate(fallbackLocale ?? '') ?? DEFAULT_STT_LOCALE;
  if (normalizedFallback === normalizedPrimary) {
    return {
      primary: normalizedPrimary,
      fallback: null
    };
  }

  return {
    primary: normalizedPrimary,
    fallback: normalizedFallback
  };
}

function scheduleVoiceMicrotask(callback: () => void): void {
  Promise.resolve().then(callback).catch(() => {
    // No-op
  });
}

function isPermissionLikeMessage(rawMessage: string): boolean {
  const normalized = rawMessage.toLowerCase();
  return (
    normalized.includes('permission') ||
    normalized.includes('not-allowed') ||
    normalized.includes('audio-capture') ||
    normalized.includes('denied')
  );
}

function isUnsupportedLikeMessage(rawMessage: string): boolean {
  const normalized = rawMessage.toLowerCase();
  return (
    normalized.includes('service-not-allowed') ||
    normalized.includes('language-not-supported') ||
    normalized.includes('recognition is unavailable') ||
    normalized.includes('speech recognition is unavailable') ||
    normalized.includes('not supported')
  );
}

function classifyWebErrorReason(event: WebSpeechRecognitionErrorEvent): VoiceSessionEndReason {
  const code = (event.error ?? '').toLowerCase();
  if (code === 'no-speech') {
    return 'no_speech';
  }
  if (code === 'aborted') {
    return 'aborted';
  }
  if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture') {
    return 'permission';
  }
  return 'transient';
}

function classifyStartErrorReason(error: unknown): VoiceSessionEndReason {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'Speech recognition failed';
  if (isUnsupportedLikeMessage(message)) {
    return 'unsupported';
  }
  return isPermissionLikeMessage(message) ? 'permission' : 'transient';
}

function classifyNativeErrorReason(rawErrorCode: string | null | undefined, rawMessage: string): VoiceSessionEndReason {
  const code = (rawErrorCode ?? '').trim().toLowerCase();
  if (code === 'no-speech' || code === 'nomatch') {
    return 'no_speech';
  }
  if (code === 'aborted') {
    return 'aborted';
  }
  if (code === 'service-not-allowed' || code === 'language-not-supported') {
    return 'unsupported';
  }
  if (code === 'not-allowed' || code === 'audio-capture') {
    return 'permission';
  }
  if (isUnsupportedLikeMessage(rawMessage)) {
    return 'unsupported';
  }
  if (isPermissionLikeMessage(rawMessage)) {
    return 'permission';
  }
  if (rawMessage.toLowerCase().includes('no speech')) {
    return 'no_speech';
  }
  if (rawMessage.toLowerCase().includes('aborted')) {
    return 'aborted';
  }
  return 'transient';
}

function getAndroidApiLevel(): number | null {
  if (Platform.OS !== 'android') {
    return null;
  }

  const rawVersion = Platform.Version;
  const parsed =
    typeof rawVersion === 'number'
      ? rawVersion
      : Number.parseInt(typeof rawVersion === 'string' ? rawVersion : '', 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function getNativeStartOptions(locale: string): {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  addsPunctuation: boolean;
} {
  const androidApiLevel = getAndroidApiLevel();
  const supportsContinuous = Platform.OS !== 'android' || androidApiLevel === null || androidApiLevel >= 33;
  const supportsPunctuation = Platform.OS !== 'android' || androidApiLevel === null || androidApiLevel >= 33;
  return {
    lang: locale,
    interimResults: true,
    maxAlternatives: 1,
    continuous: supportsContinuous,
    addsPunctuation: supportsPunctuation
  };
}

function cleanupWebRecognition(): void {
  const recognition = activeWebRecognition;
  activeWebRecognition = null;

  if (!recognition) {
    return;
  }

  recognition.onresult = null;
  recognition.onerror = null;
  recognition.onend = null;

  try {
    recognition.stop();
  } catch {
    try {
      recognition.abort?.();
    } catch {
      // No-op
    }
  }
}

function cleanupNativeRecognition(): void {
  if (Platform.OS === 'web') {
    return;
  }

  const module = getSpeechRecognitionModule();
  try {
    module?.stop();
  } catch {
    // No-op
  } finally {
    clearNativeListeners();
  }
}

function cleanupActiveRecognition(): void {
  cleanupWebRecognition();
  cleanupNativeRecognition();
}

function extractWebTranscript(event: WebSpeechRecognitionEvent): string {
  const fallbackIndex =
    typeof event.resultIndex === 'number' ? event.resultIndex : Math.max(0, (event.results?.length ?? 1) - 1);
  const resultList = event.results?.[fallbackIndex] ?? event.results?.[0];
  const transcript = resultList?.[0]?.transcript?.trim();
  return transcript ?? '';
}

export async function requestVoicePermission(): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Boolean(getWebSpeechRecognitionCtor());
  }

  const module = getSpeechRecognitionModule();
  if (module) {
    try {
      const result = await module.requestPermissionsAsync();
      return result.granted;
    } catch {
      return false;
    }
  }

  return false;
}

export function startVoiceListeningSession({
  locale,
  fallbackLocale,
  onResult,
  onEnd
}: StartVoiceListeningSessionOptions): VoiceListeningSession {
  const sessionId = nextVoiceSessionId;
  nextVoiceSessionId += 1;
  let stopped = false;
  let pendingWebEndReason: VoiceSessionEndReason | null = null;
  let pendingWebEndMessage: string | null = null;
  let webRestartAttemptCount = 0;

  const stop = () => {
    if (stopped) {
      return;
    }

    stopped = true;
    if (activeVoiceSessionId !== sessionId) {
      return;
    }

    cleanupActiveRecognition();
    activeVoiceSessionId = null;
  };

  const session: VoiceListeningSession = {
    id: sessionId,
    stop
  };

  const emitResult = (transcript: string) => {
    if (stopped || activeVoiceSessionId !== sessionId) {
      return;
    }

    const normalizedTranscript = transcript.trim();
    if (!normalizedTranscript) {
      return;
    }

    onResult({
      sessionId,
      transcript: normalizedTranscript
    });
  };

  const emitEnd = (reason: VoiceSessionEndReason, rawMessage?: string | null) => {
    if (stopped || activeVoiceSessionId !== sessionId) {
      return;
    }

    stopped = true;
    cleanupActiveRecognition();
    activeVoiceSessionId = null;
    onEnd({
      sessionId,
      reason,
      message: normalizeVoiceErrorMessage(rawMessage)
    });
  };

  cleanupActiveRecognition();
  activeVoiceSessionId = sessionId;
  const resolvedLocales = resolveSttLocales(locale, fallbackLocale);

  if (Platform.OS === 'web') {
    const WebRecognitionCtor = getWebSpeechRecognitionCtor();
    if (!WebRecognitionCtor) {
      scheduleVoiceMicrotask(() => {
        emitEnd('unsupported', 'Speech recognition is unavailable on this build.');
      });
      return session;
    }

    const recognition = new WebRecognitionCtor();
    activeWebRecognition = recognition;

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = resolvedLocales.primary;

    recognition.onresult = (event) => {
      const transcript = extractWebTranscript(event);
      if (transcript) {
        webRestartAttemptCount = 0;
        pendingWebEndReason = null;
        pendingWebEndMessage = null;
        emitResult(transcript);
      }
    };

    recognition.onerror = (event) => {
      const reason = classifyWebErrorReason(event);
      const message = event.message || event.error || 'Speech recognition failed';

      if (reason === 'permission') {
        emitEnd(reason, message);
        return;
      }

      pendingWebEndReason = reason;
      pendingWebEndMessage = message;
    };

    recognition.onend = () => {
      if (stopped || activeVoiceSessionId !== sessionId) {
        return;
      }

      const endReason = pendingWebEndReason ?? 'ended_unexpectedly';
      const endMessage = pendingWebEndMessage ?? 'Speech recognition ended unexpectedly';
      pendingWebEndReason = null;
      pendingWebEndMessage = null;

      if (webRestartAttemptCount >= WEB_SESSION_MAX_RESTARTS) {
        emitEnd(endReason, endMessage);
        return;
      }

      webRestartAttemptCount += 1;
      try {
        recognition.start();
      } catch (error) {
        emitEnd(
          endReason,
          error instanceof Error ? error.message : typeof error === 'string' ? error : endMessage
        );
      }
    };

    try {
      recognition.start();
    } catch (error) {
      const reason = classifyStartErrorReason(error);
      if (reason !== 'permission' && resolvedLocales.fallback) {
        try {
          recognition.lang = resolvedLocales.fallback;
          recognition.start();
        } catch (fallbackError) {
          const fallbackMessage =
            fallbackError instanceof Error
              ? fallbackError.message
              : typeof fallbackError === 'string'
                ? fallbackError
                : 'Speech recognition failed';
          scheduleVoiceMicrotask(() => {
            emitEnd(classifyStartErrorReason(fallbackError), fallbackMessage);
          });
          return session;
        }
      } else {
        const message =
          error instanceof Error ? error.message : typeof error === 'string' ? error : 'Speech recognition failed';
        scheduleVoiceMicrotask(() => {
          emitEnd(reason, message);
        });
        return session;
      }
    }

    return session;
  }

  const module = getSpeechRecognitionModule();
  if (module) {
    if (typeof module.isRecognitionAvailable === 'function' && !module.isRecognitionAvailable()) {
      scheduleVoiceMicrotask(() => {
        emitEnd('unsupported', 'Speech recognition service is unavailable on this device.');
      });
      return session;
    }

    activeNativeListeners = [
      module.addListener('result', (event) => {
        const transcript = event?.results?.[0]?.transcript?.trim();
        if (transcript) {
          emitResult(transcript);
        }
      }),
      module.addListener('error', (event) => {
        const message = event?.message || event?.error || 'Speech recognition failed';
        emitEnd(classifyNativeErrorReason(event?.error, message), message);
      }),
      module.addListener('end', () => {
        emitEnd('ended_unexpectedly', 'Speech recognition ended unexpectedly');
      })
    ];

    try {
      module.start(getNativeStartOptions(resolvedLocales.primary));
    } catch (error) {
      const reason = classifyStartErrorReason(error);
      if (reason !== 'permission' && resolvedLocales.fallback) {
        try {
          module.start(getNativeStartOptions(resolvedLocales.fallback));
        } catch (fallbackError) {
          const fallbackMessage =
            fallbackError instanceof Error
              ? fallbackError.message
              : typeof fallbackError === 'string'
                ? fallbackError
                : 'Speech recognition failed';
          scheduleVoiceMicrotask(() => {
            emitEnd(classifyStartErrorReason(fallbackError), fallbackMessage);
          });
          return session;
        }
      } else {
        const message =
          error instanceof Error ? error.message : typeof error === 'string' ? error : 'Speech recognition failed';
        scheduleVoiceMicrotask(() => {
          emitEnd(reason, message);
        });
        return session;
      }
    }

    return session;
  }

  scheduleVoiceMicrotask(() => {
    emitEnd('unsupported', 'Speech recognition is unavailable on this build.');
  });
  return session;
}

export async function synthesizeVoice(
  text: string,
  artistId: string,
  language: string,
  accessToken: string,
  options?: FetchVoiceOptions
): Promise<string> {
  const uri = await fetchAndCacheVoice(text, artistId, language, accessToken, {
    ...options,
    throwOnError: true
  });
  if (!uri) {
    throw new Error('TTS unavailable');
  }
  return uri;
}
