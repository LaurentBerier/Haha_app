import React from 'react';
import { renderToString } from 'react-dom/server';
import { useGameTts } from './useGameTts';

type Selector<TState, TResult> = (state: TState) => TResult;

interface MockStoreState {
  session: {
    accessToken: string;
    user: {
      accountType: string | null;
      role: string | null;
    };
  } | null;
  voiceAutoPlay: boolean;
}

const mockStoreRef: { current: MockStoreState | null } = { current: null };
const mockFetchAndCacheVoice = jest.fn<Promise<string | null>, unknown[]>();
const mockAudioPlayer = {
  playQueue: jest.fn(async () => undefined),
  stop: jest.fn(async () => undefined)
};

jest.mock('../../store/useStore', () => {
  const useStore = <TResult>(selector: Selector<MockStoreState, TResult>): TResult => {
    if (!mockStoreRef.current) {
      throw new Error('Mock store state is not initialized');
    }
    return selector(mockStoreRef.current);
  };

  Object.assign(useStore, {
    getState: () => {
      if (!mockStoreRef.current) {
        throw new Error('Mock store state is not initialized');
      }
      return mockStoreRef.current;
    }
  });

  return { useStore };
});

jest.mock('../../hooks/useAudioPlayer', () => ({
  useAudioPlayer: () => mockAudioPlayer
}));

jest.mock('../../services/ttsService', () => ({
  fetchAndCacheVoice: (...args: unknown[]) => mockFetchAndCacheVoice(...args)
}));

function renderHook(): ReturnType<typeof useGameTts> {
  let captured: ReturnType<typeof useGameTts> | null = null;

  function Harness(): null {
    captured = useGameTts({
      artistId: 'cathy-gauthier',
      language: 'fr-CA',
      contextTag: 'tarot-cathy'
    });
    return null;
  }

  renderToString(React.createElement(Harness));
  if (!captured) {
    throw new Error('Failed to capture hook');
  }
  return captured as ReturnType<typeof useGameTts>;
}

describe('useGameTts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStoreRef.current = {
      session: {
        accessToken: 'token-voice',
        user: {
          accountType: 'free',
          role: null
        }
      },
      voiceAutoPlay: true
    };
    mockFetchAndCacheVoice.mockResolvedValue('blob:https://ha-ha.ai/game.mp3');
  });

  it('does nothing when voice auto-play is off', async () => {
    const state = mockStoreRef.current as MockStoreState;
    state.voiceAutoPlay = false;
    const hook = renderHook();

    await hook.speak('Salut de test', 'game:event:1');

    expect(mockFetchAndCacheVoice).not.toHaveBeenCalled();
    expect(mockAudioPlayer.playQueue).not.toHaveBeenCalled();
  });

  it('deduplicates playback when the same event key is replayed', async () => {
    const hook = renderHook();

    await hook.speak('Texte A', 'game:event:stable');
    await hook.speak('Texte A', 'game:event:stable');

    expect(mockFetchAndCacheVoice).toHaveBeenCalledTimes(1);
    expect(mockAudioPlayer.playQueue).toHaveBeenCalledTimes(1);
  });

  it('skips when access token is missing', async () => {
    const state = mockStoreRef.current as MockStoreState;
    state.session = {
      accessToken: '',
      user: {
        accountType: 'free',
        role: null
      }
    };
    const hook = renderHook();

    await hook.speak('Texte B', 'game:event:2');

    expect(mockFetchAndCacheVoice).not.toHaveBeenCalled();
    expect(mockAudioPlayer.playQueue).not.toHaveBeenCalled();
  });
});
