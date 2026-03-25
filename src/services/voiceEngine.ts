import { NativeModules, Platform } from 'react-native';
import { fetchAndCacheVoice, type FetchVoiceOptions } from './ttsService';

type Listener = { remove: () => void };
type SpeechRecognitionModule = {
  requestPermissionsAsync: () => Promise<{ granted: boolean }>;
  addListener: (
    eventName: 'result' | 'error',
    callback: (event: {
      results?: Array<{ transcript?: string }>;
      message?: string;
      error?: string;
    }) => void
  ) => Listener;
  start: (options: {
    lang: string;
    interimResults: boolean;
    maxAlternatives: number;
    continuous: boolean;
    addsPunctuation: boolean;
  }) => void;
  stop: () => void;
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

function hasSpeechRecognitionNativeBinding(): boolean {
  if (Platform.OS === 'web') {
    return false;
  }

  const rnNativeModules = NativeModules as Record<string, unknown> | undefined;
  if (rnNativeModules?.ExpoSpeechRecognition) {
    return true;
  }

  const scope = globalThis as {
    ExpoModules?: Record<string, unknown>;
    expo?: { modules?: Record<string, unknown> };
  };

  if (scope.ExpoModules?.ExpoSpeechRecognition) {
    return true;
  }

  if (scope.expo?.modules?.ExpoSpeechRecognition) {
    return true;
  }

  return false;
}

function getSpeechRecognitionModule(): SpeechRecognitionModule | null {
  if (cachedModule !== undefined) {
    return cachedModule;
  }

  if (!hasSpeechRecognitionNativeBinding()) {
    cachedModule = null;
    if (!hasLoggedMissingNativeSpeechModule) {
      hasLoggedMissingNativeSpeechModule = true;
      console.warn('[voiceEngine] ExpoSpeechRecognition native module is missing in this build.');
    }
    return cachedModule;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require('expo-speech-recognition') as { ExpoSpeechRecognitionModule?: SpeechRecognitionModule };
    cachedModule = loaded?.ExpoSpeechRecognitionModule ?? null;
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
    normalized.includes('service-not-allowed') ||
    normalized.includes('audio-capture') ||
    normalized.includes('denied')
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
  return isPermissionLikeMessage(message) ? 'permission' : 'transient';
}

function classifyNativeErrorReason(rawMessage: string): VoiceSessionEndReason {
  if (isPermissionLikeMessage(rawMessage)) {
    return 'permission';
  }
  return 'transient';
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
    activeNativeListeners = [
      module.addListener('result', (event) => {
        const transcript = event.results?.[0]?.transcript?.trim();
        if (transcript) {
          emitResult(transcript);
        }
      }),
      module.addListener('error', (event) => {
        const message = event.message || event.error || 'Speech recognition failed';
        emitEnd(classifyNativeErrorReason(message), message);
      })
    ];

    try {
      module.start({
        lang: resolvedLocales.primary,
        interimResults: true,
        maxAlternatives: 1,
        continuous: true,
        addsPunctuation: true
      });
    } catch (error) {
      const reason = classifyStartErrorReason(error);
      if (reason !== 'permission' && resolvedLocales.fallback) {
        try {
          module.start({
            lang: resolvedLocales.fallback,
            interimResults: true,
            maxAlternatives: 1,
            continuous: true,
            addsPunctuation: true
          });
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
