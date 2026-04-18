type NativeListener = (event?: { results?: Array<{ transcript?: string }>; message?: string; error?: string }) => void;

function loadNativeVoiceEngine({
  os = 'ios',
  version = '17.0',
  isRecognitionAvailable = true,
  executionEnvironment = 'bare',
  appOwnership = null as string | null,
  nativeModuleMode = 'available'
}: {
  os?: 'ios' | 'android';
  version?: string | number;
  isRecognitionAvailable?: boolean;
  executionEnvironment?: 'bare' | 'standalone' | 'storeClient';
  appOwnership?: string | null;
  nativeModuleMode?: 'available' | 'missing' | 'throws';
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

  jest.doMock('expo-constants', () => ({
    __esModule: true,
    default: {
      executionEnvironment,
      appOwnership
    },
    ExecutionEnvironment: {
      Bare: 'bare',
      Standalone: 'standalone',
      StoreClient: 'storeClient'
    }
  }));

  jest.doMock('expo', () => ({
    requireOptionalNativeModule: jest.fn(() => {
      if (nativeModuleMode === 'available') {
        return nativeModule;
      }
      if (nativeModuleMode === 'throws') {
        throw new Error("Cannot find native module 'ExpoSpeechRecognition'");
      }
      return null;
    })
  }));

  jest.doMock('expo-audio', () => ({
    setAudioModeAsync: jest.fn(async () => undefined)
  }));

  jest.doMock('../platform/platformCapabilities', () => ({
    isIosMobileWebRuntime: () => false
  }));

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const voiceEngine = require('./voiceEngine') as typeof import('./voiceEngine');
  return { voiceEngine, nativeModule, listeners };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForNativeSessionStartup(): Promise<void> {
  await wait(80);
  await Promise.resolve();
}

describe('voiceEngine native behavior', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('emits ended_unexpectedly when native recognition ends without an explicit error event', async () => {
    const { voiceEngine, listeners } = loadNativeVoiceEngine();
    const onEnd = jest.fn();

    const session = voiceEngine.startVoiceListeningSession({
      locale: 'fr-CA',
      onResult: jest.fn(),
      onEnd
    });
    await waitForNativeSessionStartup();

    listeners.end?.[0]?.();

    expect(onEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'ended_unexpectedly'
      })
    );
    session.stop();
    await wait(0);
  });

  it('classifies native no-speech errors as no_speech (non-terminal recovery class)', async () => {
    const { voiceEngine, listeners } = loadNativeVoiceEngine();
    const onEnd = jest.fn();

    const session = voiceEngine.startVoiceListeningSession({
      locale: 'fr-CA',
      onResult: jest.fn(),
      onEnd
    });
    await waitForNativeSessionStartup();

    listeners.error?.[0]?.({
      error: 'no-speech',
      message: 'No speech detected'
    });

    expect(onEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'no_speech'
      })
    );
    session.stop();
    await wait(0);
  });

  it('disables continuous mode and punctuation on Android API 31 and below', async () => {
    const { voiceEngine, nativeModule } = loadNativeVoiceEngine({
      os: 'android',
      version: 31
    });

    const session = voiceEngine.startVoiceListeningSession({
      locale: 'fr-CA',
      onResult: jest.fn(),
      onEnd: jest.fn()
    });

    // module.start() is called inside an async IIFE (after the native settle delay + audio setup)
    await waitForNativeSessionStartup();

    expect(nativeModule.start).toHaveBeenCalledWith(
      expect.objectContaining({
        continuous: false,
        addsPunctuation: false
      })
    );
    session.stop();
    await wait(0);
  });

  it('returns false instead of throwing when the native speech module cannot be loaded', async () => {
    const { voiceEngine } = loadNativeVoiceEngine({
      nativeModuleMode: 'throws'
    });

    await expect(voiceEngine.requestVoicePermission()).resolves.toBe(false);
  });

  it('does not attempt loading native speech recognition while running in Expo Go', async () => {
    const { voiceEngine } = loadNativeVoiceEngine({
      executionEnvironment: 'storeClient',
      appOwnership: 'expo',
      nativeModuleMode: 'throws'
    });

    await expect(voiceEngine.requestVoicePermission()).resolves.toBe(false);
  });
});
