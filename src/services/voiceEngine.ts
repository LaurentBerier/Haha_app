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

let listeners: Listener[] = [];
let cachedModule: SpeechRecognitionModule | null | undefined;

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

export async function requestVoicePermission(): Promise<boolean> {
  const module = getSpeechRecognitionModule();
  if (!module) {
    return false;
  }

  try {
    const result = await module.requestPermissionsAsync();
    return result.granted;
  } catch {
    return false;
  }
}

export function startListening(
  locale: string,
  onResult: (text: string) => void,
  onError: (error: Error) => void
): void {
  const module = getSpeechRecognitionModule();
  if (!module) {
    onError(new Error('Speech recognition is unavailable on this build.'));
    return;
  }

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
  }
}

export function stopListening(): void {
  const module = getSpeechRecognitionModule();
  try {
    module?.stop();
  } finally {
    clearListeners();
  }
}

export async function synthesizeVoice(): Promise<string> {
  throw new Error('Voice synthesis not available yet');
}
