type NativeListener = (event?: { results?: Array<{ transcript?: string }>; message?: string; error?: string }) => void;

function loadNativeVoiceEngine({
  os = 'ios',
  version = '17.0',
  isRecognitionAvailable = true
}: {
  os?: 'ios' | 'android';
  version?: string | number;
  isRecognitionAvailable?: boolean;
} = {}) {
  jest.resetModules();

  const listeners: Record<string, NativeListener[]> = {};
  const nativeModule = {
    requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
    addListener: jest.fn((eventName: string, callback: NativeListener) => {
      if (!listeners[eventName]) {
        listeners[eventName] = [];
      }
      listeners[eventName]?.push(callback);
      return { remove: jest.fn() };
    }),
    start: jest.fn(),
    stop: jest.fn(),
    isRecognitionAvailable: jest.fn(() => isRecognitionAvailable)
  };

  jest.doMock('react-native', () => ({
    Platform: {
      OS: os,
      Version: version
    }
  }));

  jest.doMock('./ttsService', () => ({
    fetchAndCacheVoice: jest.fn()
  }));

  jest.doMock('expo-speech-recognition', () => ({
    ExpoSpeechRecognitionModule: nativeModule
  }));

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const voiceEngine = require('./voiceEngine') as typeof import('./voiceEngine');
  return { voiceEngine, nativeModule, listeners };
}

describe('voiceEngine native behavior', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('emits ended_unexpectedly when native recognition ends without an explicit error event', () => {
    const { voiceEngine, listeners } = loadNativeVoiceEngine();
    const onEnd = jest.fn();

    voiceEngine.startVoiceListeningSession({
      locale: 'fr-CA',
      onResult: jest.fn(),
      onEnd
    });

    listeners.end?.[0]?.();

    expect(onEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'ended_unexpectedly'
      })
    );
  });

  it('classifies native no-speech errors as no_speech (non-terminal recovery class)', () => {
    const { voiceEngine, listeners } = loadNativeVoiceEngine();
    const onEnd = jest.fn();

    voiceEngine.startVoiceListeningSession({
      locale: 'fr-CA',
      onResult: jest.fn(),
      onEnd
    });

    listeners.error?.[0]?.({
      error: 'no-speech',
      message: 'No speech detected'
    });

    expect(onEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'no_speech'
      })
    );
  });

  it('disables continuous mode and punctuation on Android API 31 and below', () => {
    const { voiceEngine, nativeModule } = loadNativeVoiceEngine({
      os: 'android',
      version: 31
    });

    voiceEngine.startVoiceListeningSession({
      locale: 'fr-CA',
      onResult: jest.fn(),
      onEnd: jest.fn()
    });

    expect(nativeModule.start).toHaveBeenCalledWith(
      expect.objectContaining({
        continuous: false,
        addsPunctuation: false
      })
    );
  });
});
