jest.mock('react-native', () => ({
  Platform: {
    OS: 'web'
  }
}));

jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => ({
    play: jest.fn(),
    pause: jest.fn(),
    remove: jest.fn(),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    volume: 1,
    playing: false,
    isLoaded: false
  })),
  setAudioModeAsync: jest.fn(async () => undefined)
}));

import React from 'react';
import { renderToString } from 'react-dom/server';
import { __resetWebAutoplayUnlockServiceForTests } from '../services/webAutoplayUnlockService';
import { useAudioPlayer } from './useAudioPlayer';

type FakePlayMode = 'resolve' | 'reject_not_allowed' | 'reject_error';

class FakeWebAudio {
  static mode: FakePlayMode = 'resolve';

  private listeners: Record<string, Set<() => void>> = {};

  src = '';

  volume = 1;

  constructor(src?: string) {
    this.src = src ?? '';
  }

  addEventListener(event: string, handler: () => void): void {
    if (!this.listeners[event]) {
      this.listeners[event] = new Set();
    }
    this.listeners[event]?.add(handler);
  }

  removeEventListener(event: string, handler: () => void): void {
    this.listeners[event]?.delete(handler);
  }

  pause(): void {
    this.emit('pause');
  }

  async play(): Promise<void> {
    if (FakeWebAudio.mode === 'resolve') {
      this.emit('playing');
      return;
    }

    if (FakeWebAudio.mode === 'reject_not_allowed') {
      const blockedError = new Error('Autoplay blocked by browser policy.') as Error & { name: string };
      blockedError.name = 'NotAllowedError';
      throw blockedError;
    }

    throw new Error('Generic playback failure');
  }

  private emit(event: string): void {
    const listeners = this.listeners[event];
    if (!listeners) {
      return;
    }
    listeners.forEach((listener) => {
      listener();
    });
  }
}

function renderUseAudioPlayerHook(): ReturnType<typeof useAudioPlayer> {
  let captured: ReturnType<typeof useAudioPlayer> | null = null;
  const Harness = (): null => {
    captured = useAudioPlayer();
    return null;
  };

  renderToString(React.createElement(Harness));
  if (!captured) {
    throw new Error('Failed to capture useAudioPlayer return value');
  }
  return captured;
}

describe('useAudioPlayer playback result contract', () => {
  const originalAudioCtor = (globalThis as { Audio?: unknown }).Audio;

  beforeEach(() => {
    FakeWebAudio.mode = 'resolve';
    (globalThis as { Audio?: unknown }).Audio = FakeWebAudio;
    __resetWebAutoplayUnlockServiceForTests();
  });

  afterEach(() => {
    __resetWebAutoplayUnlockServiceForTests();
    (globalThis as { Audio?: unknown }).Audio = originalAudioCtor;
  });

  it('returns invalid_queue when no playable URI is provided', async () => {
    const controller = renderUseAudioPlayerHook();
    let result: Awaited<ReturnType<ReturnType<typeof useAudioPlayer>['playQueue']>> | null = null;

    result = await controller.playQueue(['   ']);

    expect(result).toEqual({
      started: false,
      reason: 'invalid_queue'
    });
  });

  it('returns started=true on successful web playback start', async () => {
    const controller = renderUseAudioPlayerHook();
    let result: Awaited<ReturnType<ReturnType<typeof useAudioPlayer>['playQueue']>> | null = null;

    result = await controller.playQueue(['https://example.com/cathy.mp3'], {
      messageId: 'msg-voice-1'
    });

    expect(result).toEqual({
      started: true,
      reason: null
    });
  });

  it('returns web_autoplay_blocked when browser rejects play() with NotAllowedError', async () => {
    FakeWebAudio.mode = 'reject_not_allowed';
    const controller = renderUseAudioPlayerHook();
    let result: Awaited<ReturnType<ReturnType<typeof useAudioPlayer>['playQueue']>> | null = null;

    result = await controller.playQueue(['https://example.com/cathy.mp3'], {
      messageId: 'msg-voice-2'
    });

    expect(result).toEqual({
      started: false,
      reason: 'web_autoplay_blocked'
    });
  });

  it('returns playback_error on non-autoplay playback errors', async () => {
    FakeWebAudio.mode = 'reject_error';
    const controller = renderUseAudioPlayerHook();
    let result: Awaited<ReturnType<ReturnType<typeof useAudioPlayer>['playQueue']>> | null = null;

    result = await controller.playQueue(['https://example.com/cathy.mp3']);

    expect(result).toEqual({
      started: false,
      reason: 'playback_error'
    });
  });
});
