import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionErrorEvent,
  type ExpoSpeechRecognitionResultEvent
} from 'expo-speech-recognition';

type Listener = { remove: () => void };

let listeners: Listener[] = [];

function clearListeners(): void {
  listeners.forEach((listener) => listener.remove());
  listeners = [];
}

export async function requestVoicePermission(): Promise<boolean> {
  try {
    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
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
  clearListeners();

  listeners.push(
    ExpoSpeechRecognitionModule.addListener('result', (event: ExpoSpeechRecognitionResultEvent) => {
      const transcript = event.results[0]?.transcript?.trim();
      if (transcript) {
        onResult(transcript);
      }
    }),
    ExpoSpeechRecognitionModule.addListener('error', (event: ExpoSpeechRecognitionErrorEvent) => {
      onError(new Error(event.message || event.error || 'Speech recognition failed'));
    })
  );

  try {
    ExpoSpeechRecognitionModule.start({
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
  try {
    ExpoSpeechRecognitionModule.stop();
  } finally {
    clearListeners();
  }
}

export async function synthesizeVoice(): Promise<string> {
  throw new Error('Voice synthesis not available yet');
}
