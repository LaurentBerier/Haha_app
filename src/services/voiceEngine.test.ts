jest.mock('react-native', () => ({
  Platform: {
    OS: 'web'
  },
  NativeModules: {}
}));

jest.mock('./ttsService', () => ({
  fetchAndCacheVoice: jest.fn()
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    executionEnvironment: 'bare',
    appOwnership: null
  },
  ExecutionEnvironment: {
    Bare: 'bare',
    Standalone: 'standalone',
    StoreClient: 'storeClient'
  }
}));

jest.mock('expo', () => ({
  requireOptionalNativeModule: jest.fn(() => null)
}));

import { startVoiceListeningSession } from './voiceEngine';

class MockSpeechRecognition {
  static instances: MockSpeechRecognition[] = [];
  static startPlan: Array<(instance: MockSpeechRecognition) => void> = [];

  continuous = false;
  interimResults = false;
  lang = 'fr-CA';
  maxAlternatives = 1;
  onresult: ((event: {
    resultIndex: number;
    results: { length: number; [index: number]: { length: number; [index: number]: { transcript?: string } } };
  }) => void) | null = null;
  onerror: ((event: { error?: string; message?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = jest.fn(() => {
    const step = MockSpeechRecognition.startPlan.shift();
    if (step) {
      step(this);
    }
  });
  stop = jest.fn();

  constructor() {
    MockSpeechRecognition.instances.push(this);
  }
}

describe('voiceEngine', () => {
  beforeEach(() => {
    MockSpeechRecognition.instances = [];
    MockSpeechRecognition.startPlan = [];
    (globalThis as { SpeechRecognition?: typeof MockSpeechRecognition }).SpeechRecognition = MockSpeechRecognition;
  });

  afterEach(() => {
    delete (globalThis as { SpeechRecognition?: typeof MockSpeechRecognition }).SpeechRecognition;
  });

  it('restarts the same web session on early onend events before surfacing a terminal end', () => {
    const onEnd = jest.fn();
    const session = startVoiceListeningSession({
      locale: 'fr-CA',
      onResult: jest.fn(),
      onEnd
    });

    expect(session.id).toBeGreaterThan(0);
    expect(MockSpeechRecognition.instances).toHaveLength(1);

    MockSpeechRecognition.instances[0]?.onend?.();

    expect(onEnd).not.toHaveBeenCalled();
    expect(MockSpeechRecognition.instances[0]?.start).toHaveBeenCalledTimes(2);
  });

  it('emits a terminal end after the web session exhausts its internal restart budget', () => {
    const onEnd = jest.fn();
    const session = startVoiceListeningSession({
      locale: 'fr-CA',
      onResult: jest.fn(),
      onEnd
    });

    const recognition = MockSpeechRecognition.instances[0];
    recognition?.onend?.();
    recognition?.onend?.();
    recognition?.onend?.();
    recognition?.onend?.();

    expect(onEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: session.id,
        reason: 'ended_unexpectedly'
      })
    );
  });

  it('retries start once with fallback locale when primary locale fails to start', () => {
    const onEnd = jest.fn();
    MockSpeechRecognition.startPlan = [
      () => {
        throw new Error('unsupported locale');
      },
      () => {}
    ];

    const session = startVoiceListeningSession({
      locale: 'zz-ZZ',
      fallbackLocale: 'en-CA',
      onResult: jest.fn(),
      onEnd
    });

    const recognition = MockSpeechRecognition.instances[0];

    expect(session.id).toBeGreaterThan(0);
    expect(recognition?.start).toHaveBeenCalledTimes(2);
    expect(recognition?.lang).toBe('en-CA');
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('ignores stale session callbacks after a newer session takes over', () => {
    const staleOnResult = jest.fn();
    const freshOnResult = jest.fn();

    const firstSession = startVoiceListeningSession({
      locale: 'fr-CA',
      onResult: staleOnResult,
      onEnd: jest.fn()
    });
    const firstRecognition = MockSpeechRecognition.instances[0];

    const secondSession = startVoiceListeningSession({
      locale: 'fr-CA',
      onResult: freshOnResult,
      onEnd: jest.fn()
    });
    const secondRecognition = MockSpeechRecognition.instances[1];

    firstSession.stop();
    firstRecognition?.onresult?.({
      resultIndex: 0,
      results: {
        length: 1,
        0: {
          length: 1,
          0: {
            transcript: 'stale'
          }
        }
      }
    });
    secondRecognition?.onresult?.({
      resultIndex: 0,
      results: {
        length: 1,
        0: {
          length: 1,
          0: {
            transcript: 'fresh'
          }
        }
      }
    });

    expect(staleOnResult).not.toHaveBeenCalled();
    expect(freshOnResult).toHaveBeenCalledWith({
      sessionId: secondSession.id,
      transcript: 'fresh'
    });
  });
});
