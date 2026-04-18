import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('react-native', () => ({
  Platform: {
    OS: 'web'
  }
}));

jest.mock('../i18n', () => ({
  t: (value: string) => value
}));

const mockRequestVoicePermission = jest.fn();
const mockStartVoiceListeningSession = jest.fn();

jest.mock('../services/voiceEngine', () => ({
  requestVoicePermission: (...args: unknown[]) => mockRequestVoicePermission(...args),
  startVoiceListeningSession: (...args: unknown[]) => mockStartVoiceListeningSession(...args)
}));

jest.mock('../platform/platformCapabilities', () => ({
  isIosMobileWebRuntime: () => true
}));

import {
  type UseVoiceConversationProps,
  type UseVoiceConversationReturn,
  useVoiceConversation
} from './useVoiceConversation';

interface MockSession {
  id: number;
  stop: jest.Mock;
  onAudioStart: () => void;
  onResult: (event: { sessionId: number; transcript: string }) => void;
  onEnd: (event: { sessionId: number; reason: 'stopped' | 'unsupported' | 'permission' | 'no_speech' | 'aborted' | 'ended_unexpectedly' | 'transient' | 'error'; message: string | null }) => void;
}

let latestHook: UseVoiceConversationReturn | null = null;
let renderer: TestRenderer.ReactTestRenderer | null = null;
let mountedProps: UseVoiceConversationProps | null = null;
let nextSessionId = 1;
let sessions: MockSession[] = [];
let consoleErrorSpy: jest.SpyInstance | null = null;

function HookHarness(props: UseVoiceConversationProps): null {
  latestHook = useVoiceConversation(props);
  return null;
}

function getHook(): UseVoiceConversationReturn {
  if (!latestHook) {
    throw new Error('Hook is not mounted');
  }
  return latestHook;
}

async function advanceTimersByTime(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

async function mountHook(overrides: Partial<UseVoiceConversationProps> = {}): Promise<void> {
  mountedProps = {
    enabled: true,
    disabled: false,
    isPlaying: false,
    isAudioPlaybackLoading: false,
    hasTypedDraft: false,
    onSend: jest.fn(),
    onStopAudio: jest.fn(),
    language: 'fr-CA',
    fallbackLanguage: 'fr-CA',
    autoStartOnWeb: true,
    ...overrides
  };

  await act(async () => {
    renderer = TestRenderer.create(React.createElement(HookHarness, mountedProps));
    await Promise.resolve();
  });
}

async function updateHookProps(overrides: Partial<UseVoiceConversationProps>): Promise<void> {
  if (!mountedProps || !renderer) {
    throw new Error('Hook is not mounted');
  }

  mountedProps = {
    ...mountedProps,
    ...overrides
  };

  await act(async () => {
    renderer?.update(React.createElement(HookHarness, mountedProps as UseVoiceConversationProps));
    await Promise.resolve();
  });
}

async function mountAndStartPostPlaybackSession(): Promise<void> {
  await mountHook({ isPlaying: true });

  act(() => {
    getHook().resumeListening();
  });

  expect(getHook().status).toBe('assistant_busy');
  await updateHookProps({ isPlaying: false });
  expect(mockStartVoiceListeningSession).toHaveBeenCalledTimes(1);
}

describe('useVoiceConversation iOS web liveness watchdog', () => {
  const previousActEnv = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    latestHook = null;
    mountedProps = null;
    nextSessionId = 1;
    sessions = [];
    mockStartVoiceListeningSession.mockImplementation((options: Record<string, unknown>) => {
      const session = {
        id: nextSessionId,
        stop: jest.fn()
      };
      nextSessionId += 1;
      sessions.push({
        id: session.id,
        stop: session.stop,
        onAudioStart: options.onAudioStart as () => void,
        onResult: options.onResult as (event: { sessionId: number; transcript: string }) => void,
        onEnd: options.onEnd as (event: {
          sessionId: number;
          reason: 'stopped' | 'unsupported' | 'permission' | 'no_speech' | 'aborted' | 'ended_unexpectedly' | 'transient' | 'error';
          message: string | null;
        }) => void
      });
      return session;
    });
  });

  afterEach(async () => {
    if (renderer) {
      await act(async () => {
        renderer?.unmount();
      });
      renderer = null;
    }
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
    jest.useRealTimers();
  });

  afterAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previousActEnv;
  });

  it('recovers from a zombie session when audio starts but no result arrives', async () => {
    await mountAndStartPostPlaybackSession();

    await act(async () => {
      sessions[0]?.onAudioStart();
    });

    expect(getHook().status).toBe('listening');

    await advanceTimersByTime(14_000);
    expect(sessions[0]?.stop).toHaveBeenCalledTimes(1);
    expect(getHook().status).toBe('recovering');

    await advanceTimersByTime(1_500);
    expect(mockStartVoiceListeningSession).toHaveBeenCalledTimes(2);
    expect(getHook().status).toBe('starting');
  });

  it('cancels watchdog recovery after receiving a transcript result', async () => {
    await mountAndStartPostPlaybackSession();

    await act(async () => {
      sessions[0]?.onAudioStart();
      sessions[0]?.onResult({ sessionId: sessions[0]?.id ?? -1, transcript: 'Bonjour Cathy' });
    });

    await advanceTimersByTime(16_000);

    expect(mockStartVoiceListeningSession).toHaveBeenCalledTimes(1);
    expect(sessions[0]?.stop).not.toHaveBeenCalled();
    expect(getHook().status).toBe('listening');
  });

  it('arms watchdog for manual resume on iOS web and recovers zombie sessions', async () => {
    await mountHook();

    act(() => {
      getHook().resumeListening();
    });

    await act(async () => {
      sessions[0]?.onAudioStart();
    });

    await advanceTimersByTime(14_000);

    expect(mockStartVoiceListeningSession).toHaveBeenCalledTimes(1);
    expect(sessions[0]?.stop).toHaveBeenCalledTimes(1);
    expect(getHook().status).toBe('recovering');
  });

  it('uses a final bare-locale recovery attempt before pausing', async () => {
    await mountAndStartPostPlaybackSession();

    await act(async () => {
      sessions[0]?.onAudioStart();
    });
    await advanceTimersByTime(14_000);
    expect(getHook().status).toBe('recovering');
    await advanceTimersByTime(1_500);
    expect(mockStartVoiceListeningSession).toHaveBeenCalledTimes(2);

    await act(async () => {
      sessions[1]?.onAudioStart();
    });
    await advanceTimersByTime(14_000);
    expect(getHook().status).toBe('recovering');
    await advanceTimersByTime(2_000);
    expect(mockStartVoiceListeningSession).toHaveBeenCalledTimes(3);

    await act(async () => {
      sessions[2]?.onAudioStart();
    });
    await advanceTimersByTime(14_000);

    expect(getHook().status).toBe('recovering');
    expect(mockStartVoiceListeningSession).toHaveBeenCalledTimes(3);

    await advanceTimersByTime(2_000);
    expect(mockStartVoiceListeningSession).toHaveBeenCalledTimes(4);

    await act(async () => {
      sessions[3]?.onAudioStart();
    });
    await advanceTimersByTime(14_000);

    expect(getHook().status).toBe('recovering');
    expect(mockStartVoiceListeningSession).toHaveBeenCalledTimes(4);
  });
});
