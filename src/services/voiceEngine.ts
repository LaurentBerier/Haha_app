import { Platform } from 'react-native';
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

let listeners: Listener[] = [];
let cachedModule: SpeechRecognitionModule | null | undefined;
let webRecognition: WebSpeechRecognition | null = null;
let webShouldRestart = false;

function getSpeechRecognitionModule(): SpeechRecognitionModule | null {
  if (cachedModule !== undefined) {
    return cachedModule;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require('expo-speech-recognition') as { ExpoSpeechRecognitionModule?: SpeechRecognitionModule };
    cachedModule = loaded?.ExpoSpeechRecognitionModule ?? null;
  } catch {
    cachedModule = null;
  }

  return cachedModule;
}

function clearListeners(): void {
  listeners.forEach((listener) => listener.remove());
  listeners = [];
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

function isWebSpeechSecureContext(): boolean {
  if (Platform.OS !== 'web') {
    return true;
  }

  const scope = globalThis as { isSecureContext?: boolean };
  return Boolean(scope.isSecureContext);
}

function stopWebListening(): void {
  webShouldRestart = false;
  const recognition = webRecognition;
  webRecognition = null;

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

function extractWebTranscript(event: WebSpeechRecognitionEvent): string {
  const fallbackIndex =
    typeof event.resultIndex === 'number' ? event.resultIndex : Math.max(0, (event.results?.length ?? 1) - 1);
  const resultList = event.results?.[fallbackIndex] ?? event.results?.[0];
  const transcript = resultList?.[0]?.transcript?.trim();
  return transcript ?? '';
}

export async function requestVoicePermission(): Promise<boolean> {
  if (Platform.OS === 'web') {
    if (!isWebSpeechSecureContext()) {
      console.error('[voiceEngine] Web STT unavailable in insecure context (use HTTPS or localhost).');
      return false;
    }
    const hasRecognition = Boolean(getWebSpeechRecognitionCtor());
    if (!hasRecognition) {
      console.error('[voiceEngine] Web SpeechRecognition API unavailable in this browser.');
    }
    return hasRecognition;
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

export function startListening(
  locale: string,
  onResult: (text: string) => void,
  onError: (error: Error) => void
): boolean {
  if (Platform.OS === 'web') {
    if (!isWebSpeechSecureContext()) {
      const message = 'Speech recognition requires a secure context (HTTPS or localhost).';
      console.error('[voiceEngine] Insecure context blocked Web Speech API.', { locale });
      onError(new Error(message));
      return false;
    }

    const WebRecognitionCtor = getWebSpeechRecognitionCtor();
    if (!WebRecognitionCtor) {
      onError(new Error('Speech recognition is unavailable on this build.'));
      return false;
    }

    stopWebListening();
    const recognition = new WebRecognitionCtor();
    webRecognition = recognition;
    webShouldRestart = true;

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = locale;

    recognition.onresult = (event) => {
      const transcript = extractWebTranscript(event);
      if (transcript) {
        onResult(transcript);
      }
    };

    recognition.onerror = (event) => {
      const code = (event.error ?? '').toLowerCase();
      if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture') {
        webShouldRestart = false;
      }
      const message = event.message || event.error || 'Speech recognition failed';
      console.error('[voiceEngine] Web Speech error', { code: event.error, message, locale });
      onError(new Error(message));
    };

    recognition.onend = () => {
      if (!webShouldRestart || webRecognition !== recognition) {
        return;
      }

      try {
        recognition.start();
      } catch {
        webShouldRestart = false;
      }
    };

    try {
      recognition.start();
    } catch (error) {
      const normalized =
        error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Speech recognition failed');
      console.error('[voiceEngine] Web Speech start failed', { locale, error: normalized.message });
      onError(normalized);
      stopWebListening();
      return false;
    }
    return true;
  }

  const module = getSpeechRecognitionModule();
  if (module) {
    clearListeners();

    listeners.push(
      module.addListener('result', (event) => {
        const transcript = event.results?.[0]?.transcript?.trim();
        if (transcript) {
          onResult(transcript);
        }
      }),
      module.addListener('error', (event) => {
        onError(new Error(event.message || event.error || 'Speech recognition failed'));
      })
    );

    try {
      module.start({
        lang: locale,
        interimResults: true,
        maxAlternatives: 1,
        continuous: true,
        addsPunctuation: true
      });
    } catch (error) {
      const normalized =
        error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Speech recognition failed');
      onError(normalized);
      clearListeners();
      return false;
    }
    return true;
  }

  onError(new Error('Speech recognition is unavailable on this build.'));
  return false;
}

export function stopListening(): void {
  stopWebListening();
  if (Platform.OS === 'web') {
    return;
  }

  const module = getSpeechRecognitionModule();
  try {
    module?.stop();
  } finally {
    clearListeners();
  }
}

export async function synthesizeVoice(
  text: string,
  artistId: string,
  language: string,
  accessToken: string,
  options?: FetchVoiceOptions
): Promise<string> {
  const uri = await fetchAndCacheVoice(text, artistId, language, accessToken, options);
  if (!uri) {
    throw new Error('TTS unavailable');
  }
  return uri;
}
