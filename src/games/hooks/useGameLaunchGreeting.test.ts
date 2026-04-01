import React from 'react';
import { act, create } from 'react-test-renderer';
import { setLanguage } from '../../i18n';

type Selector<TState, TResult> = (state: TState) => TResult;

interface MockStoreState {
  language: string;
  userProfile: {
    preferredName: string | null;
  } | null;
  session: {
    accessToken: string;
  } | null;
}

const mockStoreRef: { current: MockStoreState } = {
  current: {
    language: 'fr-CA',
    userProfile: {
      preferredName: 'Laurent'
    },
    session: {
      accessToken: 'token-game-greeting'
    }
  }
};

const mockFetchGameGreetingFromApi = jest.fn<Promise<string | null>, unknown[]>();
const mockSpeak = jest.fn<Promise<void>, unknown[]>();

jest.mock('../../store/useStore', () => {
  const useStore = <TResult>(selector: Selector<MockStoreState, TResult>): TResult => {
    return selector(mockStoreRef.current);
  };

  return { useStore };
});

jest.mock('../services/gameGreetingService', () => ({
  fetchGameGreetingFromApi: (...args: unknown[]) => mockFetchGameGreetingFromApi(...args)
}));

jest.mock('./useGameTts', () => ({
  useGameTts: () => ({
    speak: (...args: unknown[]) => mockSpeak(...args),
    stop: jest.fn(async () => undefined)
  })
}));

import { buildFallbackGameLaunchGreeting, useGameLaunchGreeting } from './useGameLaunchGreeting';

interface HookHarnessProps {
  capture: (state: ReturnType<typeof useGameLaunchGreeting>) => void;
}

function HookHarness({ capture }: HookHarnessProps) {
  const state = useGameLaunchGreeting({
    artistId: 'cathy-gauthier',
    artistName: 'Cathy Gauthier',
    gameType: 'tarot-cathy',
    gameLabel: 'Tirage de Tarot',
    gameDescription: 'Cathy tire 3 cartes et lit ton avenir.',
    enabled: true
  });
  capture(state);
  return null;
}

async function flushAsyncEffects(iterations = 3): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('useGameLaunchGreeting', () => {
  const originalReactActEnvironmentFlag = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  let consoleErrorSpy: jest.SpyInstance | null = null;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      const [firstArg] = args;
      const message = typeof firstArg === 'string' ? firstArg : '';
      if (
        message.includes('react-test-renderer is deprecated') ||
        message.includes('not configured to support act') ||
        message.includes('was not wrapped in act')
      ) {
        return;
      }
      return;
    });
    mockFetchGameGreetingFromApi.mockReset();
    mockSpeak.mockReset();
    setLanguage('fr-CA');
    mockStoreRef.current = {
      language: 'fr-CA',
      userProfile: {
        preferredName: 'Laurent'
      },
      session: {
        accessToken: 'token-game-greeting'
      }
    };
  });

  afterEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      originalReactActEnvironmentFlag;
    consoleErrorSpy?.mockRestore();
  });

  it('builds a structured fallback greeting with explain, joke and provocation', () => {
    const greeting = buildFallbackGameLaunchGreeting({
      language: 'fr-CA',
      gameType: 'vrai-ou-invente',
      gameDescription: '2 vraies, 1 inventée. Trouve le mensonge.'
    });

    expect(greeting).toContain('Le principe:');
    expect(greeting).toContain('On y va');
    expect(greeting).not.toContain('Salut');
    expect(greeting).not.toContain("Moi, c'est");
    expect(greeting.split('\n\n').length).toBeGreaterThanOrEqual(3);
  });

  it('resolves loading -> ready, sanitizes intro phrases, and keeps intro visible until dismiss', async () => {
    mockFetchGameGreetingFromApi.mockResolvedValue('  Salut API tarot.  ');

    const latestStateRef: { current: ReturnType<typeof useGameLaunchGreeting> | null } = { current: null };
    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(
        React.createElement(HookHarness, {
          capture: (state) => {
            latestStateRef.current = state;
          }
        })
      );
    });

    await flushAsyncEffects();

    expect(latestStateRef.current?.isGreetingLoading).toBe(false);
    expect(latestStateRef.current?.greetingText).toContain('En gros, tu choisis un thème');
    expect(latestStateRef.current?.greetingText).toContain('Clique « On y va! »');
    expect(latestStateRef.current?.greetingText).not.toContain('Salut API tarot.');
    expect(latestStateRef.current?.isIntroVisible).toBe(true);

    act(() => {
      latestStateRef.current?.dismissIntro();
    });

    expect(latestStateRef.current?.isIntroVisible).toBe(false);
    await act(async () => {
      renderer?.unmount();
    });
  });

  it('keeps API greeting when it has no welcome or self-intro phrase', async () => {
    mockFetchGameGreetingFromApi.mockResolvedValue(
      'Le principe: tu choisis un thème, je tire trois cartes.\n\nBlague: même mes cartes sont moins dramatiques que ton lundi.'
    );

    const latestStateRef: { current: ReturnType<typeof useGameLaunchGreeting> | null } = { current: null };
    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(
        React.createElement(HookHarness, {
          capture: (state) => {
            latestStateRef.current = state;
          }
        })
      );
    });

    await flushAsyncEffects();

    expect(latestStateRef.current?.isGreetingLoading).toBe(false);
    expect(latestStateRef.current?.greetingText).toContain('Le principe: tu choisis un thème');
    expect(latestStateRef.current?.greetingText).toContain('Blague: même mes cartes');
    expect(latestStateRef.current?.greetingText).not.toContain('Salut');

    await act(async () => {
      renderer?.unmount();
    });
  });

  it('plays greeting TTS once per intro cycle and ignores repeat calls', async () => {
    mockFetchGameGreetingFromApi.mockResolvedValue('Bonjour pour le lancement.');

    const latestStateRef: { current: ReturnType<typeof useGameLaunchGreeting> | null } = { current: null };
    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(
        React.createElement(HookHarness, {
          capture: (state) => {
            latestStateRef.current = state;
          }
        })
      );
    });

    await flushAsyncEffects();

    await act(async () => {
      await latestStateRef.current?.playGreetingTtsIfEligible();
    });
    await act(async () => {
      await latestStateRef.current?.playGreetingTtsIfEligible();
    });

    expect(mockSpeak).toHaveBeenCalledTimes(1);
    await act(async () => {
      renderer?.unmount();
    });
  });

  it('does not play greeting TTS while loading is still in progress', async () => {
    const resolveGreetingRef: { current: ((value: string | null) => void) | null } = { current: null };
    mockFetchGameGreetingFromApi.mockReturnValue(
      new Promise<string | null>((resolve) => {
        resolveGreetingRef.current = resolve;
      })
    );

    const latestStateRef: { current: ReturnType<typeof useGameLaunchGreeting> | null } = { current: null };
    let renderer: ReturnType<typeof create> | null = null;
    await act(async () => {
      renderer = create(
        React.createElement(HookHarness, {
          capture: (state) => {
            latestStateRef.current = state;
          }
        })
      );
    });

    await act(async () => {
      await latestStateRef.current?.playGreetingTtsIfEligible();
    });
    expect(mockSpeak).not.toHaveBeenCalled();

    resolveGreetingRef.current?.('Salut après chargement');
    await flushAsyncEffects();
    await act(async () => {
      renderer?.unmount();
    });
  });
});
