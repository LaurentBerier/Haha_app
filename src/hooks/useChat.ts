import { useCallback, useEffect, useMemo, useRef } from 'react';
import { MAX_MESSAGE_LENGTH } from '../config/constants';
import { USE_MOCK_LLM } from '../config/env';
import { getAllCathyFewShots, getCathyModeFewShots } from '../data/cathy-gauthier/modeFewShots';
import { getLanguage, setLanguage } from '../i18n';
import type { ChatError } from '../models/ChatError';
import type { ChatSendPayload } from '../models/ChatSendPayload';
import type { Conversation } from '../models/Conversation';
import type { Message } from '../models/Message';
import type { ClaudeContentBlock, ClaudeMessage } from '../services/claudeApiService';
import { streamClaudeResponse } from '../services/claudeApiService';
import { streamMockReply } from '../services/mockLlmService';
import { buildSystemPrompt, formatConversationHistory } from '../services/personalityEngineService';
import { useStore } from '../store/useStore';
import { shouldAutoSwitchToEnglish } from '../utils/languageDetection';
import { generateId } from '../utils/generateId';

interface StreamJob {
  artistMessageId: string;
  mockUserTurn: string;
  claudeUserMessage: ClaudeMessage;
  systemPrompt: string;
  history: ClaudeMessage[];
  language: string;
  modeFewShots: ReturnType<typeof getCathyModeFewShots>;
  modeId: string;
}

function findConversationById(conversations: Record<string, Conversation[]>, conversationId: string): Conversation | null {
  if (!conversationId) {
    return null;
  }

  for (const conversationList of Object.values(conversations)) {
    const found = conversationList.find((conversation) => conversation.id === conversationId);
    if (found) {
      return found;
    }
  }

  return null;
}

function createClaudeUserContent(text: string, payload: ChatSendPayload): string | ClaudeContentBlock[] {
  if (!payload.image) {
    return text;
  }

  const blocks: ClaudeContentBlock[] = [];
  if (text) {
    blocks.push({ type: 'text', text });
  }

  blocks.push({
    type: 'image',
    source: {
      type: 'base64',
      media_type: payload.image.mediaType,
      data: payload.image.base64
    }
  });

  return blocks;
}

function createMockUserTurn(text: string, hasImage: boolean): string {
  if (!hasImage) {
    return text;
  }

  return text ? `${text}\n[Image jointe]` : '[Image jointe]';
}

export function useChat(conversationId: string) {
  const addMessage = useStore((state) => state.addMessage);
  const updateMessage = useStore((state) => state.updateMessage);
  const appendMessageContent = useStore((state) => state.appendMessageContent);
  const getMessages = useStore((state) => state.getMessages);
  const incrementUsage = useStore((state) => state.incrementUsage);
  const updateConversation = useStore((state) => state.updateConversation);

  const conversations = useStore((state) => state.conversations);
  const artists = useStore((state) => state.artists);
  const messages = useStore((state) => state.messagesByConversation[conversationId]?.messages ?? []);

  const currentConversation = useMemo(
    () => findConversationById(conversations, conversationId),
    [conversations, conversationId]
  );

  const currentArtist = useMemo(() => {
    if (!currentConversation) {
      return null;
    }
    return artists.find((artist) => artist.id === currentConversation.artistId) ?? null;
  }, [artists, currentConversation]);

  const modeFewShots = useMemo(() => {
    if (!currentConversation?.modeId || currentConversation.artistId !== 'cathy-gauthier') {
      return [];
    }

    const dedicated = getCathyModeFewShots(currentConversation.modeId);
    return dedicated.length > 0 ? dedicated : getAllCathyFewShots();
  }, [currentConversation?.artistId, currentConversation?.modeId]);

  const queueRef = useRef<StreamJob[]>([]);
  const isStreamingRef = useRef(false);
  const runNextLockRef = useRef(false);
  const activeMessageIdRef = useRef<string | null>(null);
  const streamingConversationIdRef = useRef<string | null>(null);
  const isCancelledRef = useRef(false);
  const cancelRef = useRef<null | (() => void)>(null);

  const runNext = useCallback(() => {
    if (!conversationId || runNextLockRef.current) {
      return;
    }

    runNextLockRef.current = true;

    try {
      if (isStreamingRef.current) {
        return;
      }

      const nextJob = queueRef.current.shift();
      if (!nextJob) {
        return;
      }

      const {
        artistMessageId,
        mockUserTurn,
        claudeUserMessage,
        systemPrompt,
        history,
        language,
        modeFewShots,
        modeId
      } = nextJob;
      const jobConversationId = conversationId;
      isStreamingRef.current = true;
      activeMessageIdRef.current = artistMessageId;
      streamingConversationIdRef.current = jobConversationId;
      isCancelledRef.current = false;
      let fallbackStarted = false;

      const resetStreamState = () => {
        isStreamingRef.current = false;
        activeMessageIdRef.current = null;
        streamingConversationIdRef.current = null;
        isCancelledRef.current = false;
        cancelRef.current = null;
      };

      const onToken = (token: string) => {
        if (isCancelledRef.current) {
          return;
        }
        if (streamingConversationIdRef.current !== jobConversationId) {
          return;
        }
        appendMessageContent(jobConversationId, artistMessageId, token);
      };

      const onComplete = ({ tokensUsed }: { tokensUsed: number }) => {
        updateMessage(jobConversationId, artistMessageId, {
          status: 'complete',
          metadata: { tokensUsed }
        });
        incrementUsage(tokensUsed);
        resetStreamState();
        runNext();
      };

      const failStream = (error: Error) => {
        console.error('[Chat] Generation failed:', error.message);
        updateMessage(jobConversationId, artistMessageId, { status: 'error' });
        resetStreamState();
        runNext();
      };

      const startMockStream = () =>
        streamMockReply({
          systemPrompt,
          userTurn: mockUserTurn,
          language,
          modeFewShots,
          modeId,
          onToken,
          onComplete,
          onError: failStream
        });

      const startClaudeStream = () =>
        streamClaudeResponse({
          systemPrompt,
          messages: [...history, claudeUserMessage],
          onToken,
          onComplete,
          onError: (error) => {
            if (fallbackStarted || isCancelledRef.current) {
              return;
            }

            fallbackStarted = true;
            console.warn('[Chat] Claude failed, falling back to mock:', error.message);
            updateMessage(jobConversationId, artistMessageId, { status: 'pending' });
            const fallbackCancel = startMockStream();
            cancelRef.current = () => {
              isCancelledRef.current = true;
              fallbackCancel();
            };
          }
        });

      const rawCancel = USE_MOCK_LLM ? startMockStream() : startClaudeStream();

      cancelRef.current = () => {
        isCancelledRef.current = true;
        rawCancel();
      };
    } finally {
      runNextLockRef.current = false;
    }
  }, [appendMessageContent, conversationId, incrementUsage, updateMessage]);

  const sendMessage = (payload: ChatSendPayload): ChatError | null => {
    const trimmed = payload.text.trim();
    const hasImage = Boolean(payload.image);

    if ((!trimmed && !hasImage) || !conversationId || !currentConversation || !currentArtist) {
      return null;
    }

    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      return { code: 'messageTooLong', maxLength: MAX_MESSAGE_LENGTH };
    }

    const preferredLanguage = currentConversation.language || getLanguage();
    const shouldSwitchToEnglish = shouldAutoSwitchToEnglish(trimmed, preferredLanguage);
    const languageForTurn = shouldSwitchToEnglish ? 'en-CA' : preferredLanguage;

    if (shouldSwitchToEnglish) {
      setLanguage('en-CA');
    }

    const now = new Date().toISOString();
    const historyBeforeSend = formatConversationHistory(getMessages(conversationId));
    const previewText = trimmed || '[Image]';

    const userMessage: Message = {
      id: generateId('msg'),
      conversationId,
      role: 'user',
      content: trimmed,
      status: 'complete',
      timestamp: now,
      metadata: payload.image
        ? {
            imageUri: payload.image.uri,
            imageMediaType: payload.image.mediaType
          }
        : undefined
    };

    const artistMessageId = generateId('msg');
    const placeholder: Message = {
      id: artistMessageId,
      conversationId,
      role: 'artist',
      content: '',
      status: 'pending',
      timestamp: now
    };

    addMessage(conversationId, userMessage);
    addMessage(conversationId, placeholder);

    const modeId = currentConversation.modeId || 'default';
    const systemPrompt = buildSystemPrompt(modeId);

    queueRef.current.push({
      artistMessageId,
      mockUserTurn: createMockUserTurn(trimmed, hasImage),
      claudeUserMessage: {
        role: 'user',
        content: createClaudeUserContent(trimmed, payload)
      },
      systemPrompt,
      history: historyBeforeSend,
      language: languageForTurn,
      modeFewShots,
      modeId
    });
    runNext();

    updateConversation(conversationId, {
      language: languageForTurn,
      lastMessagePreview: previewText,
      title: previewText.slice(0, 30)
    });

    return null;
  };

  useEffect(() => {
    const capturedId = conversationId;

    return () => {
      cancelRef.current?.();
      cancelRef.current = null;
      if (activeMessageIdRef.current) {
        updateMessage(capturedId, activeMessageIdRef.current, { status: 'error' });
        activeMessageIdRef.current = null;
      }
      queueRef.current.forEach((job) => {
        updateMessage(capturedId, job.artistMessageId, { status: 'error' });
      });
      queueRef.current = [];
      isStreamingRef.current = false;
      runNextLockRef.current = false;
      streamingConversationIdRef.current = null;
      isCancelledRef.current = false;
    };
  }, [conversationId, updateMessage]);

  const hasStreaming = useMemo(
    () =>
      messages.some(
        (message) => message.role === 'artist' && (message.status === 'pending' || message.status === 'streaming')
      ),
    [messages]
  );

  return {
    messages,
    hasStreaming,
    sendMessage
  };
}
