import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import type { AppStateStatus } from 'react-native';
import type { Message } from '../models/Message';
import type { AudioPlayerController } from './useAudioPlayer';

const mockAttemptVoiceAutoplayQueue = jest.fn();
const mockAddAppStateListener = jest.fn();
const mockedPlatform = { OS: 'web' };

jest.mock('react-native', () => ({
  AppState: {
    addEventListener: (...args: unknown[]) => mockAddAppStateListener(...args)
  },
  Platform: mockedPlatform
}));

jest.mock('../services/voiceAutoplayService', () => ({
  attemptVoiceAutoplayQueue: (...args: unknown[]) => mockAttemptVoiceAutoplayQueue(...args)
}));

import {
  DEFAULT_REPLAY_ON_FOCUS,
  resolveReplayTrackingStateAfterAttempt,
  resolveInterruptedReplayMessageId,
  shouldRetryPendingReplayWhenUnblocked,
  shouldAttemptInterruptedReplayOnAppActive,
  shouldReplayOnFocusLifecycle,
  useAutoReplayLastArtistMessage
} from './useAutoReplayLastArtistMessage';

interface HookHarnessProps {
  messages: Message[];
  audioPlayer: AudioPlayerController;
  enabled: boolean;
  hasStreaming: boolean;
  voiceAutoPlay?: boolean;
  replayOnFocus?: boolean;
}

let latestAppStateHandler: ((nextState: AppStateStatus) => void) | null = null;

function HookHarness(props: HookHarnessProps) {
  useAutoReplayLastArtistMessage(props);
  return null;
}

function createAudioPlayerState(state?: {
  isPlaying?: boolean;
  isLoading?: boolean;
  currentMessageId?: string | null;
}): AudioPlayerController {
  return {
    isPlaying: state?.isPlaying ?? false,
    isLoading: state?.isLoading ?? false,
    currentUri: null,
    currentMessageId: state?.currentMessageId ?? null,
    currentIndex: 0,
    totalChunks: 0,
    play: async () => ({ started: true, reason: null }),
    playQueue: async () => ({ started: true, reason: null }),
    appendToQueue: () => undefined,
    pause: async () => undefined,
    stop: async () => undefined,
    gracefulStop: () => undefined,
    onQueueCompleteRef: { current: null }
  };
}

function createReplayableArtistMessage(messageId: string): Message {
  return {
    id: messageId,
    conversationId: 'conv-voice',
    role: 'artist',
    content: 'Salut, je suis Cathy.',
    status: 'complete',
    timestamp: '2026-04-14T00:00:00.000Z',
    metadata: {
      voiceQueue: ['https://cdn.ha-ha.ai/voice/chunk-1.mp3']
    }
  };
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useAutoReplayLastArtistMessage helpers', () => {
  const previousActEnv = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previousActEnv;
  });

  beforeEach(() => {
    mockedPlatform.OS = 'web';
    latestAppStateHandler = null;
    mockAttemptVoiceAutoplayQueue.mockReset();
    mockAddAppStateListener.mockReset();
    mockAddAppStateListener.mockImplementation((eventName: unknown, handler: unknown) => {
      if (eventName === 'change' && typeof handler === 'function') {
        latestAppStateHandler = handler as (nextState: AppStateStatus) => void;
      }
      return {
        remove: jest.fn()
      };
    });
  });

  it('defaults focus replay to disabled', () => {
    expect(DEFAULT_REPLAY_ON_FOCUS).toBe(false);
  });

  it('disables focus replay when replayOnFocus is false', () => {
    expect(shouldReplayOnFocusLifecycle(true, false, true)).toBe(false);
  });

  it('disables focus replay when voice auto-play is off', () => {
    expect(shouldReplayOnFocusLifecycle(true, true, false)).toBe(false);
  });

  it('enables focus replay only when hook is enabled and replayOnFocus is true', () => {
    expect(shouldReplayOnFocusLifecycle(true, true, true)).toBe(true);
    expect(shouldReplayOnFocusLifecycle(false, true, true)).toBe(false);
  });

  it('captures interrupted replay message id only when app leaves active state while audio is active', () => {
    expect(
      resolveInterruptedReplayMessageId({
        nextState: 'background',
        isAudioActive: true,
        currentMessageId: 'msg-voice-1'
      })
    ).toBe('msg-voice-1');

    expect(
      resolveInterruptedReplayMessageId({
        nextState: 'inactive',
        isAudioActive: true,
        currentMessageId: ' msg-voice-2 '
      })
    ).toBe('msg-voice-2');

    expect(
      resolveInterruptedReplayMessageId({
        nextState: 'background',
        isAudioActive: false,
        currentMessageId: 'msg-voice-3'
      })
    ).toBeNull();

    expect(
      resolveInterruptedReplayMessageId({
        nextState: 'active',
        isAudioActive: true,
        currentMessageId: 'msg-voice-4'
      })
    ).toBeNull();
  });

  it('retries interrupted replay only on foreground when an interrupted message id exists', () => {
    expect(shouldAttemptInterruptedReplayOnAppActive('active', 'msg-voice-1')).toBe(true);
    expect(shouldAttemptInterruptedReplayOnAppActive('active', null)).toBe(false);
    expect(shouldAttemptInterruptedReplayOnAppActive('background', 'msg-voice-1')).toBe(false);
  });

  it('marks replay as started only when playback truly starts', () => {
    expect(resolveReplayTrackingStateAfterAttempt(null, 'msg-voice-1', 'started')).toEqual({
      nextLastStartedMessageId: 'msg-voice-1',
      nextPendingReplay: null
    });

    expect(resolveReplayTrackingStateAfterAttempt('msg-voice-1', 'msg-voice-2', 'failed')).toEqual({
      nextLastStartedMessageId: 'msg-voice-1',
      nextPendingReplay: null
    });

    expect(resolveReplayTrackingStateAfterAttempt('msg-voice-1', 'msg-voice-2', 'pending_web_unlock')).toEqual({
      nextLastStartedMessageId: 'msg-voice-1',
      nextPendingReplay: {
        messageId: 'msg-voice-2',
        status: 'pending_web_unlock'
      }
    });

    expect(
      resolveReplayTrackingStateAfterAttempt('msg-voice-1', 'msg-voice-2', 'pending_blockers', {
        shouldTrackPendingReplay: false
      })
    ).toEqual({
      nextLastStartedMessageId: 'msg-voice-1',
      nextPendingReplay: null
    });
  });

  it('retries pending blocker replay only when playback/stream blockers are gone', () => {
    expect(
      shouldRetryPendingReplayWhenUnblocked({
        pendingReplay: {
          messageId: 'msg-voice-1',
          status: 'pending_blockers'
        },
        hasStreaming: false,
        isPlaying: false,
        isLoading: false
      })
    ).toBe(true);

    expect(
      shouldRetryPendingReplayWhenUnblocked({
        pendingReplay: {
          messageId: 'msg-voice-1',
          status: 'pending_blockers'
        },
        hasStreaming: true,
        isPlaying: false,
        isLoading: false
      })
    ).toBe(false);

    expect(
      shouldRetryPendingReplayWhenUnblocked({
        pendingReplay: {
          messageId: 'msg-voice-1',
          status: 'pending_web_unlock'
        },
        hasStreaming: false,
        isPlaying: false,
        isLoading: false
      })
    ).toBe(false);
  });

  it('does not replay the same message after blockers clear when the attempt was implicit', async () => {
    const replayableMessage = createReplayableArtistMessage('msg-implicit');
    const audioPlayer = createAudioPlayerState();
    mockAttemptVoiceAutoplayQueue.mockResolvedValue('started');

    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(HookHarness, {
          messages: [replayableMessage],
          audioPlayer,
          enabled: true,
          hasStreaming: true,
          voiceAutoPlay: true,
          replayOnFocus: false
        })
      );
    });
    await flushMicrotasks();

    expect(mockAttemptVoiceAutoplayQueue).not.toHaveBeenCalled();

    await act(async () => {
      renderer!.update(
        React.createElement(HookHarness, {
          messages: [replayableMessage],
          audioPlayer,
          enabled: true,
          hasStreaming: false,
          voiceAutoPlay: true,
          replayOnFocus: false
        })
      );
    });
    await flushMicrotasks();

    expect(mockAttemptVoiceAutoplayQueue).not.toHaveBeenCalled();

    await act(async () => {
      renderer!.unmount();
    });
  });

  it('keeps initial replay on first render when a replayable message already exists', async () => {
    const replayableMessage = createReplayableArtistMessage('msg-initial');
    const audioPlayer = createAudioPlayerState();
    mockAttemptVoiceAutoplayQueue.mockResolvedValue('started');

    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(HookHarness, {
          messages: [replayableMessage],
          audioPlayer,
          enabled: true,
          hasStreaming: false,
          voiceAutoPlay: true,
          replayOnFocus: false
        })
      );
    });
    await flushMicrotasks();

    expect(mockAttemptVoiceAutoplayQueue).toHaveBeenCalledTimes(1);
    expect(mockAttemptVoiceAutoplayQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        audioPlayer,
        messageId: 'msg-initial',
        uris: ['https://cdn.ha-ha.ai/voice/chunk-1.mp3']
      })
    );

    await act(async () => {
      renderer!.unmount();
    });
  });

  it('keeps deferred resume for explicit interrupted replays', async () => {
    mockedPlatform.OS = 'ios';
    const replayableMessage = createReplayableArtistMessage('msg-interrupted');
    const audioPlayerActive = createAudioPlayerState({
      isPlaying: true,
      isLoading: false,
      currentMessageId: 'msg-interrupted'
    });
    const audioPlayerBlocked = createAudioPlayerState({
      isPlaying: false,
      isLoading: false,
      currentMessageId: null
    });
    const audioPlayerReady = createAudioPlayerState({
      isPlaying: false,
      isLoading: false,
      currentMessageId: null
    });
    mockAttemptVoiceAutoplayQueue.mockResolvedValue('started');

    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(HookHarness, {
          messages: [replayableMessage],
          audioPlayer: audioPlayerActive,
          enabled: true,
          hasStreaming: true,
          voiceAutoPlay: true,
          replayOnFocus: false
        })
      );
    });
    await flushMicrotasks();

    expect(latestAppStateHandler).toBeInstanceOf(Function);

    await act(async () => {
      latestAppStateHandler?.('background');
    });

    await act(async () => {
      renderer!.update(
        React.createElement(HookHarness, {
          messages: [replayableMessage],
          audioPlayer: audioPlayerBlocked,
          enabled: true,
          hasStreaming: true,
          voiceAutoPlay: true,
          replayOnFocus: false
        })
      );
    });
    await flushMicrotasks();

    await act(async () => {
      latestAppStateHandler?.('active');
      await Promise.resolve();
    });
    await flushMicrotasks();

    expect(mockAttemptVoiceAutoplayQueue).not.toHaveBeenCalled();

    await act(async () => {
      renderer!.update(
        React.createElement(HookHarness, {
          messages: [replayableMessage],
          audioPlayer: audioPlayerReady,
          enabled: true,
          hasStreaming: false,
          voiceAutoPlay: true,
          replayOnFocus: false
        })
      );
    });
    await flushMicrotasks();

    expect(mockAttemptVoiceAutoplayQueue).toHaveBeenCalledTimes(1);
    expect(mockAttemptVoiceAutoplayQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'msg-interrupted',
        uris: ['https://cdn.ha-ha.ai/voice/chunk-1.mp3']
      })
    );

    await act(async () => {
      renderer!.unmount();
    });
  });
});
