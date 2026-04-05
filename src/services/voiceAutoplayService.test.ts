jest.mock('react-native', () => ({
  Platform: {
    OS: 'web'
  }
}));

import type { AudioPlayerController } from '../hooks/useAudioPlayer';
import { __resetWebAutoplayUnlockServiceForTests } from './webAutoplayUnlockService';
import { attemptVoiceAutoplayQueue, attemptVoiceAutoplayQueueDetailed } from './voiceAutoplayService';

class MockDocumentEvents {
  private listeners = new Map<string, Set<() => void>>();

  addEventListener(eventName: string, handler: () => void): void {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }
    this.listeners.get(eventName)?.add(handler);
  }

  removeEventListener(eventName: string, handler: () => void): void {
    this.listeners.get(eventName)?.delete(handler);
  }

  emit(eventName: string): void {
    const handlers = this.listeners.get(eventName);
    if (!handlers) {
      return;
    }
    handlers.forEach((handler) => {
      handler();
    });
  }
}

function createAudioPlayerStub(
  playQueue: AudioPlayerController['playQueue']
): AudioPlayerController {
  return {
    isPlaying: false,
    isLoading: false,
    currentUri: null,
    currentMessageId: null,
    currentIndex: 0,
    totalChunks: 0,
    play: async () => ({ started: true, reason: null }),
    playQueue,
    appendToQueue: () => undefined,
    pause: async () => undefined,
    stop: async () => undefined,
    gracefulStop: () => undefined
  };
}

describe('voiceAutoplayService', () => {
  const originalDocument = (globalThis as { document?: unknown }).document;
  let mockDocumentEvents: MockDocumentEvents;

  beforeEach(() => {
    mockDocumentEvents = new MockDocumentEvents();
    (globalThis as { document?: unknown }).document = mockDocumentEvents;
    __resetWebAutoplayUnlockServiceForTests();
  });

  afterEach(() => {
    __resetWebAutoplayUnlockServiceForTests();
    (globalThis as { document?: unknown }).document = originalDocument;
  });

  it('returns started when player starts playback', async () => {
    const audioPlayer = createAudioPlayerStub(async () => ({
      started: true,
      reason: null
    }));

    const result = await attemptVoiceAutoplayQueue({
      audioPlayer,
      uris: ['https://example.com/cathy.mp3'],
      messageId: 'msg-voice-1'
    });

    expect(result).toBe('started');
  });

  it('returns detailed started state with no failure reason', async () => {
    const audioPlayer = createAudioPlayerStub(async () => ({
      started: true,
      reason: null
    }));

    const result = await attemptVoiceAutoplayQueueDetailed({
      audioPlayer,
      uris: ['https://example.com/cathy.mp3'],
      messageId: 'msg-voice-detailed-1'
    });

    expect(result).toEqual({
      state: 'started',
      failureReason: null
    });
  });

  it('returns pending_web_unlock and retries when the first gesture unlocks autoplay', async () => {
    const audioPlayer = createAudioPlayerStub(async () => ({
      started: false,
      reason: 'web_autoplay_blocked'
    }));
    const onWebUnlockRetry = jest.fn();

    const result = await attemptVoiceAutoplayQueue({
      audioPlayer,
      uris: ['https://example.com/cathy.mp3'],
      messageId: 'msg-voice-2',
      onWebUnlockRetry
    });
    expect(result).toBe('pending_web_unlock');
    expect(onWebUnlockRetry).not.toHaveBeenCalled();

    mockDocumentEvents.emit('pointerdown');
    expect(onWebUnlockRetry).toHaveBeenCalledTimes(1);
  });

  it('returns detailed pending_web_unlock with null failure reason', async () => {
    const audioPlayer = createAudioPlayerStub(async () => ({
      started: false,
      reason: 'web_autoplay_blocked'
    }));

    const result = await attemptVoiceAutoplayQueueDetailed({
      audioPlayer,
      uris: ['https://example.com/cathy.mp3'],
      messageId: 'msg-voice-detailed-2'
    });

    expect(result).toEqual({
      state: 'pending_web_unlock',
      failureReason: null
    });
  });

  it('returns failed on non-autoplay playback errors', async () => {
    const audioPlayer = createAudioPlayerStub(async () => ({
      started: false,
      reason: 'playback_error'
    }));

    const result = await attemptVoiceAutoplayQueue({
      audioPlayer,
      uris: ['https://example.com/cathy.mp3'],
      messageId: 'msg-voice-3'
    });

    expect(result).toBe('failed');
  });

  it('returns detailed failure reasons for playback errors', async () => {
    const playbackErrorPlayer = createAudioPlayerStub(async () => ({
      started: false,
      reason: 'playback_error'
    }));
    const interruptedPlayer = createAudioPlayerStub(async () => ({
      started: false,
      reason: 'interrupted'
    }));
    const invalidQueuePlayer = createAudioPlayerStub(async () => ({
      started: false,
      reason: 'invalid_queue'
    }));

    await expect(
      attemptVoiceAutoplayQueueDetailed({
        audioPlayer: playbackErrorPlayer,
        uris: ['https://example.com/cathy.mp3'],
        messageId: 'msg-voice-detailed-3'
      })
    ).resolves.toEqual({
      state: 'failed',
      failureReason: 'playback_error'
    });
    await expect(
      attemptVoiceAutoplayQueueDetailed({
        audioPlayer: interruptedPlayer,
        uris: ['https://example.com/cathy.mp3'],
        messageId: 'msg-voice-detailed-4'
      })
    ).resolves.toEqual({
      state: 'failed',
      failureReason: 'interrupted'
    });
    await expect(
      attemptVoiceAutoplayQueueDetailed({
        audioPlayer: invalidQueuePlayer,
        uris: ['https://example.com/cathy.mp3'],
        messageId: 'msg-voice-detailed-5'
      })
    ).resolves.toEqual({
      state: 'failed',
      failureReason: 'invalid_queue'
    });
  });
});
