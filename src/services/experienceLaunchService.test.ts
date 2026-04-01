const pushMock = jest.fn();
const fetchModeIntroFromApiMock = jest.fn<Promise<string | null>, unknown[]>(async () => null);
const generateModeIntroMock = jest.fn<string, unknown[]>(() => 'intro fallback');
const fetchAndCacheVoiceMock = jest.fn<Promise<string | null>, unknown[]>(async () => 'https://voice.test/intro.mp3');
const createConversationMock = jest.fn();
const addMessageMock = jest.fn();
const updateConversationMock = jest.fn();
const updateMessageMock = jest.fn();
const setActiveConversationMock = jest.fn();
const setVoiceAutoPlayMock = jest.fn();
const trackSessionExperienceEventMock = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => (pushMock as (...values: unknown[]) => void)(...args)
  }
}));

jest.mock('./modeIntroService', () => ({
  fetchModeIntroFromApi: (...args: unknown[]) =>
    (fetchModeIntroFromApiMock as (...values: unknown[]) => Promise<unknown>)(...args),
  generateModeIntro: (...args: unknown[]) => (generateModeIntroMock as (...values: unknown[]) => string)(...args)
}));

jest.mock('./ttsService', () => ({
  fetchAndCacheVoice: (...args: unknown[]) => (fetchAndCacheVoiceMock as (...values: unknown[]) => Promise<unknown>)(...args)
}));

interface MockMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'artist';
  content: string;
  status: 'pending' | 'streaming' | 'complete' | 'error';
  timestamp: string;
  metadata?: Record<string, unknown>;
}

const storeState = {
  artists: [
    {
      id: 'cathy-gauthier',
      supportedLanguages: ['fr-CA', 'en-CA'],
      defaultLanguage: 'fr-CA',
      supportedModeIds: ['on-jase', 'grill', 'numero-de-show', 'meme-generator', 'screenshot-analyzer']
    }
  ],
  userProfile: {
    preferredName: 'Laurent',
    memoryFacts: ['Je vis a Montreal']
  },
  session: {
    accessToken: 'token-1',
    user: {
      accountType: 'free',
      role: null
    }
  },
  conversationModeEnabled: true,
  voiceAutoPlay: true,
  messagesByConversation: {} as Record<string, { messages: MockMessage[] }>,
  createConversation: createConversationMock,
  addMessage: addMessageMock,
  updateConversation: updateConversationMock,
  updateMessage: updateMessageMock,
  setActiveConversation: setActiveConversationMock,
  setVoiceAutoPlay: setVoiceAutoPlayMock,
  trackSessionExperienceEvent: trackSessionExperienceEventMock
};

addMessageMock.mockImplementation((conversationId: string, message: MockMessage) => {
  const existing = storeState.messagesByConversation[conversationId]?.messages ?? [];
  storeState.messagesByConversation[conversationId] = {
    messages: [...existing, message]
  };
});

updateMessageMock.mockImplementation(
  (conversationId: string, messageId: string, updates: Partial<MockMessage>) => {
    const page = storeState.messagesByConversation[conversationId];
    if (!page) {
      return;
    }

    page.messages = page.messages.map((message) =>
      message.id === messageId
        ? {
            ...message,
            ...updates
          }
        : message
    );
  }
);

setVoiceAutoPlayMock.mockImplementation((enabled: boolean) => {
  storeState.voiceAutoPlay = enabled;
});

jest.mock('../store/useStore', () => ({
  useStore: {
    getState: () => storeState
  }
}));

import { launchVisibleGameRoute, launchVisibleModeConversation, tryLaunchExperienceFromText } from './experienceLaunchService';

async function settleIntroPipeline(waitMs: number): Promise<void> {
  await jest.advanceTimersByTimeAsync(waitMs);
  await Promise.resolve();
}

function extractContentUpdates(): string[] {
  return updateMessageMock.mock.calls
    .map((call) => call[2] as { content?: string } | undefined)
    .filter((updates): updates is { content?: string } => Boolean(updates && 'content' in updates))
    .map((updates) => updates.content ?? '');
}

describe('experienceLaunchService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    storeState.session.accessToken = 'token-1';
    storeState.session.user.accountType = 'free';
    storeState.session.user.role = null;
    storeState.conversationModeEnabled = true;
    storeState.voiceAutoPlay = true;
    storeState.messagesByConversation = {};
    createConversationMock.mockReturnValue({
      id: 'conv-1',
      language: 'fr-CA'
    });
    fetchModeIntroFromApiMock.mockResolvedValue(null);
    generateModeIntroMock.mockReturnValue('intro fallback');
    fetchAndCacheVoiceMock.mockResolvedValue('https://voice.test/intro.mp3');
    trackSessionExperienceEventMock.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('launches a visible mode in a dedicated mode thread with a single intro message', async () => {
    const result = launchVisibleModeConversation({
      artistId: 'cathy-gauthier',
      modeId: 'on-jase',
      fallbackLanguage: 'fr-CA'
    });

    expect(result).toEqual(
      expect.objectContaining({
        launched: true,
        targetType: 'mode',
        targetId: 'on-jase',
        conversationId: 'conv-1'
      })
    );
    expect(createConversationMock).toHaveBeenCalledWith('cathy-gauthier', 'fr-CA', 'on-jase', { threadType: 'mode' });
    expect(addMessageMock).toHaveBeenCalledTimes(1);
    expect(addMessageMock.mock.calls[0]?.[1]).toMatchObject({
      role: 'artist',
      content: '',
      status: 'pending',
      metadata: {
        injected: true,
        injectedType: 'mode_nudge'
      }
    });
    expect(setActiveConversationMock).toHaveBeenCalledWith('conv-1');
    expect(trackSessionExperienceEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        artistId: 'cathy-gauthier',
        experienceType: 'mode',
        experienceId: 'on-jase'
      })
    );
    expect(pushMock).toHaveBeenCalledWith('/chat/conv-1');
    expect(fetchModeIntroFromApiMock).toHaveBeenCalledTimes(1);

    await settleIntroPipeline(300);

    expect(extractContentUpdates()).toEqual(['intro fallback']);
    expect(updateConversationMock).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({
        lastMessagePreview: expect.stringContaining('intro fallback'),
        title: expect.stringContaining('intro fallback')
      }),
      'cathy-gauthier'
    );
  });

  it('keeps a single intro message when launching meme-generator mode', async () => {
    fetchModeIntroFromApiMock.mockResolvedValue('intro meme');

    launchVisibleModeConversation({
      artistId: 'cathy-gauthier',
      modeId: 'meme-generator',
      fallbackLanguage: 'fr-CA'
    });

    await settleIntroPipeline(350);

    const addedMessages = addMessageMock.mock.calls.map((call) => call[1] as MockMessage);
    expect(addedMessages).toHaveLength(1);
    expect(addedMessages[0]?.status).toBe('pending');
    expect(addedMessages[0]?.metadata?.memeType).toBeUndefined();
    expect(extractContentUpdates()).toEqual(['intro meme']);
  });

  it('re-enables voice auto-play when conversation mode is active during mode launch', () => {
    storeState.conversationModeEnabled = true;
    storeState.voiceAutoPlay = false;

    launchVisibleModeConversation({
      artistId: 'cathy-gauthier',
      modeId: 'on-jase',
      fallbackLanguage: 'fr-CA'
    });

    expect(setVoiceAutoPlayMock).toHaveBeenCalledWith(true);
    expect(storeState.voiceAutoPlay).toBe(true);
  });

  it('uses API intro when available before timeout', async () => {
    fetchModeIntroFromApiMock.mockResolvedValue('intro api final');

    launchVisibleModeConversation({
      artistId: 'cathy-gauthier',
      modeId: 'grill',
      fallbackLanguage: 'fr-CA'
    });

    await settleIntroPipeline(300);

    expect(extractContentUpdates()).toEqual(['intro api final']);
  });

  it('falls back after timeout and ignores late API intro updates', async () => {
    fetchModeIntroFromApiMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve('intro api tardive'), 2_000);
        })
    );

    launchVisibleModeConversation({
      artistId: 'cathy-gauthier',
      modeId: 'on-jase',
      fallbackLanguage: 'fr-CA'
    });

    await settleIntroPipeline(1_500);
    expect(extractContentUpdates()).toEqual(['intro fallback']);

    await settleIntroPipeline(700);
    expect(extractContentUpdates()).toEqual(['intro fallback']);
  });

  it('writes intro TTS metadata lifecycle for Cathy responses', async () => {
    fetchModeIntroFromApiMock.mockResolvedValue('intro voix');
    fetchAndCacheVoiceMock.mockResolvedValue('https://voice.test/intro-ready.mp3');

    launchVisibleModeConversation({
      artistId: 'cathy-gauthier',
      modeId: 'on-jase',
      fallbackLanguage: 'fr-CA'
    });

    await settleIntroPipeline(300);

    const metadataUpdates = updateMessageMock.mock.calls
      .map((call) => call[2] as { metadata?: Record<string, unknown> } | undefined)
      .filter((updates) => Boolean(updates?.metadata))
      .map((updates) => updates?.metadata ?? {});

    expect(metadataUpdates.some((metadata) => metadata.voiceStatus === 'generating')).toBe(true);
    expect(
      metadataUpdates.some(
        (metadata) =>
          metadata.voiceStatus === 'ready' &&
          Array.isArray(metadata.voiceQueue) &&
          metadata.voiceQueue[0] === 'https://voice.test/intro-ready.mp3'
      )
    ).toBe(true);
  });

  it('launches a visible game route', () => {
    const result = launchVisibleGameRoute('cathy-gauthier', 'impro-chain');

    expect(result).toEqual(
      expect.objectContaining({
        launched: true,
        targetType: 'game',
        targetId: 'impro-chain'
      })
    );
    expect(trackSessionExperienceEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        artistId: 'cathy-gauthier',
        experienceType: 'game',
        experienceId: 'impro-chain'
      })
    );
    expect(pushMock).toHaveBeenCalledWith('/games/cathy-gauthier/impro-chain');
  });

  it('launches from text command via parser', () => {
    const result = tryLaunchExperienceFromText({
      artistId: 'cathy-gauthier',
      text: 'Lance le mode Jugement de Texto',
      fallbackLanguage: 'fr-CA',
      preferredConversationLanguage: 'fr-CA'
    });

    expect(result).toEqual(
      expect.objectContaining({
        launched: true,
        targetType: 'mode',
        targetId: 'screenshot-analyzer'
      })
    );
    expect(pushMock).toHaveBeenCalledWith('/chat/conv-1');
  });

  it('preserves the active conversation language family when launching a mode', () => {
    launchVisibleModeConversation({
      artistId: 'cathy-gauthier',
      modeId: 'on-jase',
      fallbackLanguage: 'fr-CA',
      preferredConversationLanguage: 'en-US'
    });

    expect(createConversationMock).toHaveBeenCalledWith('cathy-gauthier', 'en-CA', 'on-jase', { threadType: 'mode' });
  });
});
