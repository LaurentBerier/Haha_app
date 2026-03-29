const pushMock = jest.fn();
const fetchModeIntroFromApiMock = jest.fn(async () => null);
const generateModeIntroMock = jest.fn(() => 'intro fallback');
const createConversationMock = jest.fn();
const addMessageMock = jest.fn();
const updateConversationMock = jest.fn();
const updateMessageMock = jest.fn();
const setActiveConversationMock = jest.fn();

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
    accessToken: 'token-1'
  },
  createConversation: createConversationMock,
  addMessage: addMessageMock,
  updateConversation: updateConversationMock,
  updateMessage: updateMessageMock,
  setActiveConversation: setActiveConversationMock
};

jest.mock('../store/useStore', () => ({
  useStore: {
    getState: () => storeState
  }
}));

import { launchVisibleGameRoute, launchVisibleModeConversation, tryLaunchExperienceFromText } from './experienceLaunchService';

describe('experienceLaunchService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createConversationMock.mockReturnValue({
      id: 'conv-1',
      language: 'fr-CA'
    });
  });

  it('launches a visible mode in a dedicated mode thread', () => {
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
    expect(setActiveConversationMock).toHaveBeenCalledWith('conv-1');
    expect(pushMock).toHaveBeenCalledWith('/chat/conv-1');
    expect(fetchModeIntroFromApiMock).toHaveBeenCalledTimes(1);
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
});
