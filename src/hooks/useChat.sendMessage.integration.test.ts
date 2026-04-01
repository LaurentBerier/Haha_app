import React from 'react';
import { renderToString } from 'react-dom/server';
import { ARTIST_IDS, MODE_IDS } from '../config/constants';
import type { Conversation } from '../models/Conversation';
import type { Message, MessagePage } from '../models/Message';
import { useChat } from './useChat';

type Selector<TState, TResult> = (state: TState) => TResult;

interface MockStoreState {
  addMessage: jest.Mock<void, [string, Message]>;
  updateMessage: jest.Mock;
  appendMessageContent: jest.Mock;
  getMessages: jest.Mock<Message[], [string]>;
  incrementUsage: jest.Mock;
  markThresholdMessageShown: jest.Mock;
  setBlocked: jest.Mock;
  popProfileChangeHints: jest.Mock<string[], []>;
  applyScoreAction: jest.Mock;
  updateConversation: jest.Mock;
  userProfile: null;
  session: {
    user: {
      id: string;
      displayName: string | null;
      accountType: 'free' | 'paid' | 'admin';
      role: string | null;
    };
    accessToken: string;
  };
  quota: {
    isBlocked: boolean;
    messagesCap: number;
    messagesUsed: number;
    threshold1MessageShown: boolean;
    threshold2MessageShown: boolean;
    threshold3MessageShown: boolean;
    threshold4MessageShown: boolean;
  };
  artists: Array<{ id: string; name: string }>;
  conversations: Record<string, Conversation[]>;
  messagesByConversation: Record<string, MessagePage>;
  conversationModeEnabled: boolean;
  voiceAutoPlay: boolean;
}

interface MockStreamParams {
  onToken: (token: string) => void;
  onComplete: (usage: { tokensUsed: number }) => void;
  onError: (error: Error) => void;
}

const mockStoreRef: { current: MockStoreState | null } = { current: null };
const streamMockParams: MockStreamParams[] = [];
const mockFetchAndCacheVoice = jest.fn<Promise<string | null>, unknown[]>();
const mockSaveMemoryFacts = jest.fn<Promise<void>, [string, string[]]>(async () => undefined);
const mockAddScore = jest.fn<Promise<void>, [string]>(async () => undefined);
const mockProposeMemeOptions = jest.fn<Promise<{
  draftId: string;
  options: Array<{
    optionId: string;
    caption: string;
    placement: 'top' | 'bottom';
    logoPlacement: 'left' | 'right';
    previewImageBase64: string;
    mimeType: string;
  }>;
}>, unknown[]>();
const mockFinalizeMemeImage = jest.fn<Promise<{
  imageBase64: string;
  mimeType: string;
  caption: string;
  placement: 'top' | 'bottom';
  logoPlacement: 'left' | 'right';
}>, unknown[]>();
const mockSaveMemeImage = jest.fn<Promise<{ ok: boolean; code?: string }>, unknown[]>();
const mockShareMemeImage = jest.fn<Promise<{ ok: boolean; code?: string }>, unknown[]>();
const mockStreamMockReply: (...args: unknown[]) => () => void = jest.fn((params: unknown) => {
  if (params && typeof params === 'object') {
    const candidate = params as Partial<MockStreamParams>;
    if (
      typeof candidate.onToken === 'function' &&
      typeof candidate.onComplete === 'function' &&
      typeof candidate.onError === 'function'
    ) {
      streamMockParams.push(candidate as MockStreamParams);
    }
  }

  // noop cancel
  return () => {
    // noop cancel
  };
});
const mockAudioPlayer = {
  isPlaying: false,
  isLoading: false,
  currentUri: null as string | null,
  currentMessageId: null as string | null,
  currentIndex: 0,
  totalChunks: 0,
  play: jest.fn(async () => undefined),
  playQueue: jest.fn(async () => undefined),
  appendToQueue: jest.fn(),
  pause: jest.fn(async () => undefined),
  stop: jest.fn(async () => undefined)
};

jest.mock('../config/env', () => ({
  USE_MOCK_LLM: true
}));

jest.mock('./useAudioPlayer', () => ({
  useAudioPlayer: () => mockAudioPlayer
}));

jest.mock('../services/mockLlmService', () => ({
  streamMockReply: (...args: unknown[]) => mockStreamMockReply(...args)
}));

jest.mock('../services/ttsService', () => ({
  fetchAndCacheVoice: (...args: unknown[]) => mockFetchAndCacheVoice(...args)
}));

jest.mock('../services/scoreManager', () => ({
  addScore: (...args: [string]) => mockAddScore(...args)
}));

jest.mock('../services/profileService', () => ({
  saveMemoryFacts: (...args: [string, string[]]) => mockSaveMemoryFacts(...args)
}));

jest.mock('../services/memeGeneratorService', () => ({
  proposeMemeOptions: (...args: unknown[]) => mockProposeMemeOptions(...args),
  finalizeMemeImage: (...args: unknown[]) => mockFinalizeMemeImage(...args)
}));

jest.mock('../services/memeMediaService', () => ({
  saveMemeImage: (...args: unknown[]) => mockSaveMemeImage(...args),
  shareMemeImage: (...args: unknown[]) => mockShareMemeImage(...args)
}));

jest.mock('../store/useStore', () => {
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

function createEmptyMessagePage(): MessagePage {
  return {
    messages: [],
    hasMore: false,
    cursor: null,
    messageIndexById: {}
  };
}

function createConversation(id: string, artistId = ARTIST_IDS.CATHY_GAUTHIER): Conversation {
  const timestamp = new Date('2026-03-22T14:00:00.000Z').toISOString();
  return {
    id,
    artistId,
    title: 'On jase',
    language: 'fr-CA',
    modeId: MODE_IDS.ON_JASE,
    threadType: 'mode',
    createdAt: timestamp,
    updatedAt: timestamp,
    lastMessagePreview: ''
  };
}

function createMockStoreState(): MockStoreState {
  const state: Partial<MockStoreState> = {};
  const addMessage = jest.fn<void, [string, Message]>((conversationId, message) => {
    const page = state.messagesByConversation?.[conversationId] ?? createEmptyMessagePage();
    page.messages.push(message);
    page.messageIndexById = page.messageIndexById ?? {};
    page.messageIndexById[message.id] = page.messages.length - 1;
    state.messagesByConversation = state.messagesByConversation ?? {};
    state.messagesByConversation[conversationId] = page;
  });

  const getMessages = jest.fn<Message[], [string]>((conversationId) => {
    return state.messagesByConversation?.[conversationId]?.messages ?? [];
  });
  const updateMessage = jest.fn((conversationId: string, messageId: string, updates: Partial<Message>) => {
    const page = state.messagesByConversation?.[conversationId];
    if (!page) {
      return;
    }
    const index = page.messages.findIndex((message) => message.id === messageId);
    if (index < 0) {
      return;
    }
    const current = page.messages[index];
    if (!current) {
      return;
    }
    page.messages[index] = {
      ...current,
      ...updates
    };
  });
  const appendMessageContent = jest.fn((conversationId: string, messageId: string, token: string) => {
    if (!token) {
      return;
    }
    const page = state.messagesByConversation?.[conversationId];
    if (!page) {
      return;
    }
    const index = page.messages.findIndex((message) => message.id === messageId);
    if (index < 0) {
      return;
    }
    const current = page.messages[index];
    if (!current) {
      return;
    }
    page.messages[index] = {
      ...current,
      content: current.content + token,
      status: 'streaming'
    };
  });

  Object.assign(state, {
    addMessage,
    updateMessage,
    appendMessageContent,
    getMessages,
    incrementUsage: jest.fn(),
    markThresholdMessageShown: jest.fn(),
    setBlocked: jest.fn(),
    popProfileChangeHints: jest.fn(() => []),
    applyScoreAction: jest.fn(),
    updateConversation: jest.fn(),
    userProfile: null,
    session: {
      user: {
        id: 'user-1',
        displayName: null,
        accountType: 'free',
        role: null
      },
      accessToken: ''
    },
    quota: {
      isBlocked: false,
      messagesCap: 100,
      messagesUsed: 0,
      threshold1MessageShown: false,
      threshold2MessageShown: false,
      threshold3MessageShown: false,
      threshold4MessageShown: false
    },
    artists: [
      {
        id: ARTIST_IDS.CATHY_GAUTHIER,
        name: 'Cathy Gauthier'
      }
    ],
    conversations: {},
    messagesByConversation: {},
    conversationModeEnabled: false,
    voiceAutoPlay: false
  } satisfies MockStoreState);

  return state as MockStoreState;
}

function renderUseChatHook(conversationId: string): ReturnType<typeof useChat> {
  let captured: ReturnType<typeof useChat> | null = null;

  function Harness(): null {
    captured = useChat(conversationId);
    return null;
  }

  renderToString(React.createElement(Harness));

  if (!captured) {
    throw new Error('Failed to capture useChat hook result');
  }

  return captured;
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  await Promise.resolve();
}

describe('useChat sendMessage integration', () => {
  beforeEach(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    mockStoreRef.current = createMockStoreState();
    jest.clearAllMocks();
    streamMockParams.length = 0;
    mockFetchAndCacheVoice.mockResolvedValue(null);
    mockSaveMemoryFacts.mockResolvedValue(undefined);
    mockAddScore.mockResolvedValue(undefined);
    mockProposeMemeOptions.mockResolvedValue({
      draftId: 'draft-1',
      options: [
        {
          optionId: 'opt-1',
          caption: 'Option 1',
          placement: 'top',
          logoPlacement: 'right',
          previewImageBase64: 'YmFzZTY0MQ==',
          mimeType: 'image/png'
        },
        {
          optionId: 'opt-2',
          caption: 'Option 2',
          placement: 'bottom',
          logoPlacement: 'left',
          previewImageBase64: 'YmFzZTY0Mg==',
          mimeType: 'image/png'
        },
        {
          optionId: 'opt-3',
          caption: 'Option 3',
          placement: 'top',
          logoPlacement: 'right',
          previewImageBase64: 'YmFzZTY0Mw==',
          mimeType: 'image/png'
        }
      ]
    });
    mockFinalizeMemeImage.mockResolvedValue({
      imageBase64: 'ZmluYWw=',
      mimeType: 'image/png',
      caption: 'Option 2',
      placement: 'bottom',
      logoPlacement: 'left'
    });
    mockSaveMemeImage.mockResolvedValue({ ok: true });
    mockShareMemeImage.mockResolvedValue({ ok: true });
  });

  it('adds messages when render-time context is stale but live store context is valid', () => {
    const conversationId = 'conv-live';
    const chat = renderUseChatHook(conversationId);
    expect(chat.isSendContextReady).toBe(false);

    const conversation = createConversation(conversationId);
    const state = mockStoreRef.current as MockStoreState;
    state.conversations = {
      [conversation.artistId]: [conversation]
    };
    state.messagesByConversation[conversation.id] = createEmptyMessagePage();

    const result = chat.sendMessage({ text: 'Salut Cathy' });

    expect(result).toBeNull();
    expect(state.addMessage).toHaveBeenCalledTimes(2);
    expect(state.addMessage.mock.calls[0]?.[0]).toBe(conversation.id);
    expect(state.addMessage.mock.calls[1]?.[0]).toBe(conversation.id);
    expect(state.addMessage.mock.calls[0]?.[1]).toMatchObject({
      conversationId: conversation.id,
      role: 'user',
      content: 'Salut Cathy',
      status: 'complete'
    });
    expect(state.addMessage.mock.calls[1]?.[1]).toMatchObject({
      conversationId: conversation.id,
      role: 'artist',
      content: '',
      status: 'pending'
    });
    expect(state.updateConversation).toHaveBeenCalledWith(
      conversation.id,
      expect.objectContaining({
        lastMessagePreview: 'Salut Cathy'
      }),
      conversation.artistId
    );
    expect(mockStreamMockReply).toHaveBeenCalledTimes(1);
  });

  it('returns invalidConversation and does not add messages when live conversation is missing', () => {
    const chat = renderUseChatHook('conv-missing');
    const state = mockStoreRef.current as MockStoreState;

    const result = chat.sendMessage({ text: 'Allo?' });

    expect(result).toEqual({ code: 'invalidConversation' });
    expect(state.addMessage).not.toHaveBeenCalled();
    expect(state.updateConversation).not.toHaveBeenCalled();
    expect(mockStreamMockReply).not.toHaveBeenCalled();
  });

  it('sends to explicit conversation override when provided', () => {
    const chat = renderUseChatHook('conv-stale');
    const targetConversation = createConversation('conv-bound');
    const staleConversation = createConversation('conv-stale');
    const state = mockStoreRef.current as MockStoreState;
    state.conversations = {
      [targetConversation.artistId]: [targetConversation, staleConversation]
    };
    state.messagesByConversation[targetConversation.id] = createEmptyMessagePage();
    state.messagesByConversation[staleConversation.id] = createEmptyMessagePage();

    const result = chat.sendMessage(
      { text: 'envoie dans la conversation bound' },
      { conversationId: targetConversation.id }
    );

    expect(result).toBeNull();
    expect(state.addMessage).toHaveBeenCalledTimes(2);
    expect(state.addMessage.mock.calls[0]?.[0]).toBe(targetConversation.id);
    expect(state.addMessage.mock.calls[1]?.[0]).toBe(targetConversation.id);
    expect(state.updateConversation).toHaveBeenCalledWith(
      targetConversation.id,
      expect.objectContaining({
        lastMessagePreview: 'envoie dans la conversation bound'
      }),
      targetConversation.artistId
    );
  });

  it('asks for confirmation before explicit language switch and replays pending message on yes', () => {
    const conversationId = 'conv-explicit-switch';
    const chat = renderUseChatHook(conversationId);
    const conversation = createConversation(conversationId);
    const state = mockStoreRef.current as MockStoreState;
    state.conversations = {
      [conversation.artistId]: [conversation]
    };
    state.messagesByConversation[conversation.id] = createEmptyMessagePage();

    const result = chat.sendMessage({ text: 'Parle en anglais et donne-moi la meteo.' });

    expect(result).toBeNull();
    expect(state.addMessage).toHaveBeenCalledTimes(2);
    expect(mockStreamMockReply).not.toHaveBeenCalled();

    const firstArtistMessage =
      state.messagesByConversation[conversation.id]?.messages.find((message) => message.role === 'artist') ?? null;
    expect(firstArtistMessage?.content).toContain('oui ou non');

    const firstUpdateCall = state.updateConversation.mock.calls[state.updateConversation.mock.calls.length - 1];
    expect(firstUpdateCall?.[1]).toEqual(
      expect.objectContaining({
        language: 'fr-CA',
        lastMessagePreview: 'Parle en anglais et donne-moi la meteo.'
      })
    );

    const confirmResult = chat.sendMessage({ text: 'oui vas-y stp' });
    expect(confirmResult).toBeNull();
    expect(state.addMessage).toHaveBeenCalledTimes(4);
    expect(mockStreamMockReply).toHaveBeenCalledTimes(1);

    const streamCall = (mockStreamMockReply as jest.Mock).mock.calls[0]?.[0] as { language?: string };
    expect(streamCall?.language).toBe('en-CA');

    const lastUpdateCall = state.updateConversation.mock.calls[state.updateConversation.mock.calls.length - 1];
    expect(lastUpdateCall?.[1]).toEqual(
      expect.objectContaining({
        language: 'en-CA',
        lastMessagePreview: 'Parle en anglais et donne-moi la meteo.'
      })
    );
  });

  it('asks for confirmation before explicit language switch and replays pending message on no', () => {
    const conversationId = 'conv-explicit-switch-reject';
    const chat = renderUseChatHook(conversationId);
    const conversation = createConversation(conversationId);
    const state = mockStoreRef.current as MockStoreState;
    state.conversations = {
      [conversation.artistId]: [conversation]
    };
    state.messagesByConversation[conversation.id] = createEmptyMessagePage();

    const firstResult = chat.sendMessage({ text: 'Parle en anglais et donne-moi la meteo.' });
    expect(firstResult).toBeNull();
    expect(state.addMessage).toHaveBeenCalledTimes(2);
    expect(mockStreamMockReply).not.toHaveBeenCalled();

    const secondResult = chat.sendMessage({ text: 'non reste en francais' });
    expect(secondResult).toBeNull();
    expect(state.addMessage).toHaveBeenCalledTimes(4);
    expect(mockStreamMockReply).toHaveBeenCalledTimes(1);

    const streamCall = (mockStreamMockReply as jest.Mock).mock.calls[0]?.[0] as { language?: string };
    expect(streamCall?.language).toBe('fr-CA');

    const lastUpdateCall = state.updateConversation.mock.calls[state.updateConversation.mock.calls.length - 1];
    expect(lastUpdateCall?.[1]).toEqual(
      expect.objectContaining({
        language: 'fr-CA',
        lastMessagePreview: 'Parle en anglais et donne-moi la meteo.'
      })
    );
  });

  it('uses explicit one-off language without persisting conversation language', () => {
    const conversationId = 'conv-explicit-one-off';
    const chat = renderUseChatHook(conversationId);
    const conversation = createConversation(conversationId);
    const state = mockStoreRef.current as MockStoreState;
    state.conversations = {
      [conversation.artistId]: [conversation]
    };
    state.messagesByConversation[conversation.id] = createEmptyMessagePage();

    const result = chat.sendMessage({ text: 'Dis cette phrase en allemand: Bonne journee.' });

    expect(result).toBeNull();
    expect(state.addMessage).toHaveBeenCalledTimes(2);
    expect(mockStreamMockReply).toHaveBeenCalledTimes(1);
    const streamCall = (mockStreamMockReply as jest.Mock).mock.calls[0]?.[0] as { language?: string };
    expect(streamCall?.language).toBe('de-DE');
    expect(state.updateConversation).toHaveBeenCalledWith(
      conversation.id,
      expect.objectContaining({
        language: 'fr-CA',
        lastMessagePreview: 'Dis cette phrase en allemand: Bonne journee.'
      }),
      conversation.artistId
    );
  });

  it('asks for confirmation before auto language switch and replays pending message on yes', () => {
    const conversationId = 'conv-auto-confirm-yes';
    const chat = renderUseChatHook(conversationId);
    const conversation = createConversation(conversationId);
    const state = mockStoreRef.current as MockStoreState;
    state.conversations = {
      [conversation.artistId]: [conversation]
    };
    state.messagesByConversation[conversation.id] = createEmptyMessagePage();

    const firstResult = chat.sendMessage({ text: 'I need help with this today please.' });
    expect(firstResult).toBeNull();
    expect(state.addMessage).toHaveBeenCalledTimes(2);
    expect(mockStreamMockReply).not.toHaveBeenCalled();

    const latestArtistMessage =
      state.messagesByConversation[conversation.id]?.messages.find((message) => message.role === 'artist') ?? null;
    expect(latestArtistMessage?.content).toContain('oui ou non');

    const secondResult = chat.sendMessage({ text: 'yes please continue' });
    expect(secondResult).toBeNull();
    expect(state.addMessage).toHaveBeenCalledTimes(4);
    expect(mockStreamMockReply).toHaveBeenCalledTimes(1);
    const streamCall = (mockStreamMockReply as jest.Mock).mock.calls[0]?.[0] as { language?: string };
    expect(streamCall?.language).toBe('en-CA');

    const lastUpdateCall = state.updateConversation.mock.calls[state.updateConversation.mock.calls.length - 1];
    expect(lastUpdateCall?.[1]).toEqual(
      expect.objectContaining({
        language: 'en-CA',
        lastMessagePreview: 'I need help with this today please.'
      })
    );

    const originalMessageCount =
      state.messagesByConversation[conversation.id]?.messages.filter(
        (message) => message.role === 'user' && message.content === 'I need help with this today please.'
      ).length ?? 0;
    expect(originalMessageCount).toBe(1);
  });

  it('asks for confirmation before auto language switch and replays pending message on no in current language', () => {
    const conversationId = 'conv-auto-confirm-no';
    const chat = renderUseChatHook(conversationId);
    const conversation = createConversation(conversationId);
    const state = mockStoreRef.current as MockStoreState;
    state.conversations = {
      [conversation.artistId]: [conversation]
    };
    state.messagesByConversation[conversation.id] = createEmptyMessagePage();

    const firstResult = chat.sendMessage({ text: 'I need help with this today please.' });
    expect(firstResult).toBeNull();
    expect(state.addMessage).toHaveBeenCalledTimes(2);
    expect(mockStreamMockReply).not.toHaveBeenCalled();

    const secondResult = chat.sendMessage({ text: 'non garde francais' });
    expect(secondResult).toBeNull();
    expect(state.addMessage).toHaveBeenCalledTimes(4);
    expect(mockStreamMockReply).toHaveBeenCalledTimes(1);
    const streamCall = (mockStreamMockReply as jest.Mock).mock.calls[0]?.[0] as { language?: string };
    expect(streamCall?.language).toBe('fr-CA');

    const lastUpdateCall = state.updateConversation.mock.calls[state.updateConversation.mock.calls.length - 1];
    expect(lastUpdateCall?.[1]).toEqual(
      expect.objectContaining({
        language: 'fr-CA',
        lastMessagePreview: 'I need help with this today please.'
      })
    );
  });

  it('asks for language code when explicit switch request is unrecognized and skips LLM call', () => {
    const conversationId = 'conv-unknown-switch';
    const chat = renderUseChatHook(conversationId);
    const conversation = createConversation(conversationId);
    const state = mockStoreRef.current as MockStoreState;
    state.conversations = {
      [conversation.artistId]: [conversation]
    };
    state.messagesByConversation[conversation.id] = createEmptyMessagePage();

    const result = chat.sendMessage({ text: 'Parle en klingon.' });

    expect(result).toBeNull();
    expect(state.addMessage).toHaveBeenCalledTimes(2);
    const latestArtistMessage =
      state.messagesByConversation[conversation.id]?.messages.find((message) => message.role === 'artist') ?? null;
    expect(latestArtistMessage?.status).toBe('complete');
    expect(latestArtistMessage?.content).toContain('code langue');
    expect(mockStreamMockReply).not.toHaveBeenCalled();
  });

  it('uses meme pipeline for meme-generator image uploads and returns 3 options without stream', async () => {
    const conversationId = 'conv-meme-propose';
    const chat = renderUseChatHook(conversationId);
    const conversation = createConversation(conversationId);
    const state = mockStoreRef.current as MockStoreState;
    conversation.modeId = MODE_IDS.MEME_GENERATOR;
    state.session.accessToken = 'token-meme';
    state.conversations = {
      [conversation.artistId]: [conversation]
    };
    state.messagesByConversation[conversation.id] = createEmptyMessagePage();

    const sendResult = chat.sendMessage({
      text: '',
      image: {
        uri: 'file:///tmp/photo.png',
        mediaType: 'image/png',
        base64: 'cGhvdG8='
      }
    });

    expect(sendResult).toBeNull();
    expect(mockStreamMockReply).not.toHaveBeenCalled();
    expect(mockProposeMemeOptions).toHaveBeenCalledTimes(1);

    await flushAsyncWork();

    const allMessages = state.messagesByConversation[conversation.id]?.messages ?? [];
    const optionMessages = allMessages.filter((message) => message.metadata?.memeType === 'option');
    expect(optionMessages).toHaveLength(3);
    expect(optionMessages[0]?.metadata?.imageUri).toContain('data:image/png;base64,');
    expect(optionMessages[1]?.content).toBe('Option 2');
  });

  it('ignores duplicate meme uploads while option generation is still pending', () => {
    const conversationId = 'conv-meme-pending-dedupe';
    const chat = renderUseChatHook(conversationId);
    const conversation = createConversation(conversationId);
    const state = mockStoreRef.current as MockStoreState;
    conversation.modeId = MODE_IDS.MEME_GENERATOR;
    state.session.accessToken = 'token-meme';
    state.conversations = {
      [conversation.artistId]: [conversation]
    };
    state.messagesByConversation[conversation.id] = createEmptyMessagePage();

    let resolvePropose: ((value: Awaited<ReturnType<typeof mockProposeMemeOptions>>) => void) | undefined;
    mockProposeMemeOptions.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePropose = resolve;
        })
    );

    const firstResult = chat.sendMessage({
      text: '',
      image: {
        uri: 'file:///tmp/photo.png',
        mediaType: 'image/png',
        base64: 'cGhvdG8='
      }
    });
    const secondResult = chat.sendMessage({
      text: '',
      image: {
        uri: 'file:///tmp/photo-2.png',
        mediaType: 'image/png',
        base64: 'cGhvdG8y'
      }
    });

    expect(firstResult).toBeNull();
    expect(secondResult).toBeNull();
    expect(mockProposeMemeOptions).toHaveBeenCalledTimes(1);
    expect(state.messagesByConversation[conversation.id]?.messages).toHaveLength(2);
    expect(
      state.messagesByConversation[conversation.id]?.messages.filter((message) => message.role === 'user')
    ).toHaveLength(1);
    expect(
      state.messagesByConversation[conversation.id]?.messages.filter((message) => message.status === 'pending')
    ).toHaveLength(1);

    if (!resolvePropose) {
      throw new Error('Expected proposeMemeOptions resolver to be assigned');
    }

    resolvePropose({
      draftId: 'draft-pending',
      options: [
        {
          optionId: 'opt-1',
          caption: 'Option 1',
          placement: 'top',
          logoPlacement: 'right',
          previewImageBase64: 'YmFzZTY0MQ==',
          mimeType: 'image/png'
        },
        {
          optionId: 'opt-2',
          caption: 'Option 2',
          placement: 'bottom',
          logoPlacement: 'left',
          previewImageBase64: 'YmFzZTY0Mg==',
          mimeType: 'image/png'
        },
        {
          optionId: 'opt-3',
          caption: 'Option 3',
          placement: 'top',
          logoPlacement: 'right',
          previewImageBase64: 'YmFzZTY0Mw==',
          mimeType: 'image/png'
        }
      ]
    });
  });

  it('nudges upload prompt when meme-generator receives text without an image', () => {
    const conversationId = 'conv-meme-text-only';
    const chat = renderUseChatHook(conversationId);
    const conversation = createConversation(conversationId);
    const state = mockStoreRef.current as MockStoreState;
    conversation.modeId = MODE_IDS.MEME_GENERATOR;
    state.conversations = {
      [conversation.artistId]: [conversation]
    };
    state.messagesByConversation[conversation.id] = createEmptyMessagePage();

    const sendResult = chat.sendMessage({ text: 'Fais-moi un meme vite.' });
    expect(sendResult).toBeNull();
    expect(mockStreamMockReply).not.toHaveBeenCalled();
    expect(mockProposeMemeOptions).not.toHaveBeenCalled();

    const lastArtistMessage =
      state.messagesByConversation[conversation.id]?.messages.find((message) => message.role === 'artist') ?? null;
    expect(lastArtistMessage?.metadata?.memeType).toBe('upload_prompt');
    expect(lastArtistMessage?.status).toBe('complete');
  });

  it('finalizes selected meme option and stores final image metadata', async () => {
    const conversationId = 'conv-meme-finalize';
    const chat = renderUseChatHook(conversationId);
    const conversation = createConversation(conversationId);
    const state = mockStoreRef.current as MockStoreState;
    conversation.modeId = MODE_IDS.MEME_GENERATOR;
    state.session.accessToken = 'token-meme';
    state.conversations = {
      [conversation.artistId]: [conversation]
    };
    state.messagesByConversation[conversation.id] = createEmptyMessagePage();

    chat.sendMessage({
      text: '',
      image: {
        uri: 'file:///tmp/photo.png',
        mediaType: 'image/png',
        base64: 'cGhvdG8='
      }
    });
    await flushAsyncWork();

    const optionMessage =
      state.messagesByConversation[conversation.id]?.messages.find((message) => message.metadata?.memeOptionId === 'opt-2') ??
      null;
    expect(optionMessage).not.toBeNull();

    await chat.chooseMemeOption(optionMessage?.id ?? '');
    await flushAsyncWork();

    expect(mockFinalizeMemeImage).toHaveBeenCalledTimes(1);
    expect(mockAddScore).toHaveBeenCalledWith('meme_generated');

    const finalMessage =
      state.messagesByConversation[conversation.id]?.messages
        .slice()
        .reverse()
        .find((message) => message.metadata?.memeType === 'final' && message.status === 'complete') ?? null;
    expect(finalMessage).not.toBeNull();
    expect(finalMessage?.metadata?.imageUri).toContain('data:image/png;base64,');
    expect(finalMessage?.metadata?.memeOptionId).toBe('opt-2');
  });

  it('marks voice unavailable on TTS failure and recovers to ready on retryVoiceForMessage', async () => {
    const conversationId = 'conv-voice';
    const chat = renderUseChatHook(conversationId);
    const conversation = createConversation(conversationId);
    const state = mockStoreRef.current as MockStoreState;
    state.session.accessToken = 'token-voice';
    state.conversationModeEnabled = false;
    state.conversations = {
      [conversation.artistId]: [conversation]
    };
    state.messagesByConversation[conversation.id] = createEmptyMessagePage();

    mockFetchAndCacheVoice.mockRejectedValueOnce({
      status: 429,
      code: 'RATE_LIMIT_EXCEEDED'
    });

    const sendResult = chat.sendMessage({ text: 'Lis ça à voix haute' });
    expect(sendResult).toBeNull();
    expect(streamMockParams).toHaveLength(1);

    const stream = streamMockParams[0] as MockStreamParams;
    stream.onToken('Voici une reponse vocale.');
    stream.onComplete({ tokensUsed: 12 });
    await flushAsyncWork();

    const artistMessageAfterFailure =
      state.messagesByConversation[conversation.id]?.messages.find((message) => message.role === 'artist') ?? null;
    expect(artistMessageAfterFailure).not.toBeNull();
    expect(artistMessageAfterFailure?.status).toBe('complete');
    expect(artistMessageAfterFailure?.metadata?.voiceStatus).toBe('unavailable');
    expect(artistMessageAfterFailure?.metadata?.voiceErrorCode).toBe('RATE_LIMIT_EXCEEDED');
    expect(artistMessageAfterFailure?.metadata?.voiceUrl).toBeUndefined();

    mockFetchAndCacheVoice.mockResolvedValueOnce('blob:https://ha-ha.ai/retried.mp3');
    await chat.retryVoiceForMessage(artistMessageAfterFailure?.id ?? '');
    await flushAsyncWork();

    const artistMessageAfterRetry =
      state.messagesByConversation[conversation.id]?.messages.find((message) => message.role === 'artist') ?? null;
    expect(artistMessageAfterRetry).not.toBeNull();
    expect(artistMessageAfterRetry?.metadata?.voiceStatus).toBe('ready');
    expect(artistMessageAfterRetry?.metadata?.voiceErrorCode).toBeUndefined();
    expect(artistMessageAfterRetry?.metadata?.voiceUrl).toBe('blob:https://ha-ha.ai/retried.mp3');
    expect(artistMessageAfterRetry?.metadata?.voiceQueue).toEqual(['blob:https://ha-ha.ai/retried.mp3']);
  });

  it('auto-adds a heart reaction on affectionate user turns when model omits [REACT:emoji]', async () => {
    const conversationId = 'conv-affection-reaction';
    const chat = renderUseChatHook(conversationId);
    const conversation = createConversation(conversationId);
    const state = mockStoreRef.current as MockStoreState;
    state.conversations = {
      [conversation.artistId]: [conversation]
    };
    state.messagesByConversation[conversation.id] = createEmptyMessagePage();

    const sendResult = chat.sendMessage({ text: "Je t'aime Cathy, t'es incroyable." });
    expect(sendResult).toBeNull();
    expect(streamMockParams).toHaveLength(1);

    const stream = streamMockParams[0] as MockStreamParams;
    stream.onToken("Merci, c'est fin. Je te renvoie le compliment avec plaisir.");
    stream.onComplete({ tokensUsed: 9 });
    await flushAsyncWork();

    const userMessage =
      state.messagesByConversation[conversation.id]?.messages.find((message) => message.role === 'user') ?? null;
    expect(userMessage).not.toBeNull();
    expect(userMessage?.metadata?.cathyReaction).toBe('❤️');
  });

  it('persists merged memory facts in fire-and-forget mode after successful artist reply', async () => {
    const conversationId = 'conv-memory-save';
    const chat = renderUseChatHook(conversationId);
    const conversation = createConversation(conversationId);
    const state = mockStoreRef.current as MockStoreState;
    state.conversations = {
      [conversation.artistId]: [conversation]
    };
    state.messagesByConversation[conversation.id] = createEmptyMessagePage();

    const sendResult = chat.sendMessage({ text: "Je vis a Quebec et j'aime le cafe noir." });
    expect(sendResult).toBeNull();
    expect(streamMockParams).toHaveLength(1);

    const stream = streamMockParams[0] as MockStreamParams;
    stream.onToken('Je retiens ca pour la suite.');
    stream.onComplete({ tokensUsed: 7 });
    await flushAsyncWork();

    expect(mockSaveMemoryFacts).toHaveBeenCalledTimes(1);
    expect(mockSaveMemoryFacts.mock.calls[0]?.[0]).toBe('user-1');
    expect(mockSaveMemoryFacts.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(["Je vis a Quebec et j'aime le cafe noir"]));
  });

  it('keeps replayable voice queue when first chunk succeeds and a later chunk fails terminally', async () => {
    const conversationId = 'conv-voice-chunked';
    const chat = renderUseChatHook(conversationId);
    const conversation = createConversation(conversationId);
    const state = mockStoreRef.current as MockStoreState;
    state.session.accessToken = 'token-voice';
    state.conversationModeEnabled = true;
    state.voiceAutoPlay = false;
    state.conversations = {
      [conversation.artistId]: [conversation]
    };
    state.messagesByConversation[conversation.id] = createEmptyMessagePage();

    mockFetchAndCacheVoice
      .mockResolvedValueOnce('blob:https://ha-ha.ai/chunk-1.mp3')
      .mockRejectedValueOnce({
        status: 429,
        code: 'RATE_LIMIT_EXCEEDED'
      });

    const sendResult = chat.sendMessage({ text: 'Donne-moi une version vocale complete.' });
    expect(sendResult).toBeNull();
    expect(streamMockParams).toHaveLength(1);

    const stream = streamMockParams[0] as MockStreamParams;
    stream.onToken(
      'Cathy donne une premiere phrase bien longue pour garder le flow naturel et eviter les coupures abruptes. ' +
        'Puis elle ajoute une deuxieme phrase tout aussi complete pour tester une erreur terminale sur le chunk suivant.'
    );
    stream.onComplete({ tokensUsed: 18 });
    await flushAsyncWork();
    await flushAsyncWork();

    const baseArtistMessage =
      state.messagesByConversation[conversation.id]?.messages.find(
        (message) => message.role === 'artist' && message.metadata?.injected !== true
      ) ?? null;
    expect(baseArtistMessage).not.toBeNull();
    expect(baseArtistMessage?.status).toBe('complete');
    expect(baseArtistMessage?.metadata?.voiceStatus).toBe('ready');
    expect(baseArtistMessage?.metadata?.voiceQueue).toEqual(['blob:https://ha-ha.ai/chunk-1.mp3']);
    expect(baseArtistMessage?.metadata?.voiceUrl).toBe('blob:https://ha-ha.ai/chunk-1.mp3');
    expect(baseArtistMessage?.metadata?.voiceErrorCode).toBeUndefined();
  });
});
