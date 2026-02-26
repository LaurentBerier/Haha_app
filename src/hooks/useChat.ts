import { useCallback, useEffect, useMemo, useRef } from 'react';
import { MAX_MESSAGE_LENGTH } from '../config/constants';
import { USE_MOCK_LLM } from '../config/env';
import { getAllCathyFewShots, getCathyModeFewShots } from '../data/cathy-gauthier/modeFewShots';
import type { ChatError } from '../models/ChatError';
import type { Conversation } from '../models/Conversation';
import type { Message } from '../models/Message';
import type { ClaudeMessage } from '../services/claudeApiService';
import { streamClaudeResponse } from '../services/claudeApiService';
import { streamMockReply } from '../services/mockLlmService';
import { buildSystemPrompt, formatConversationHistory } from '../services/personalityEngineService';
import { useStore } from '../store/useStore';
import { generateId } from '../utils/generateId';

interface StreamJob {
  artistMessageId: string;
  userTurn: string;
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
  const activeMessageIdRef = useRef<string | null>(null);
  const streamingConversationIdRef = useRef<string | null>(null);
  const isCancelledRef = useRef(false);
  const cancelRef = useRef<null | (() => void)>(null);

  const runNext = useCallback(() => {
    if (!conversationId || isStreamingRef.current) {
      return;
    }

    const nextJob = queueRef.current.shift();
    if (!nextJob) {
      return;
    }

    const { artistMessageId, userTurn, systemPrompt, history, language, modeFewShots, modeId } = nextJob;
    isStreamingRef.current = true;
    activeMessageIdRef.current = artistMessageId;
    streamingConversationIdRef.current = conversationId;
    isCancelledRef.current = false;

    const onToken = (token: string) => {
      if (isCancelledRef.current) {
        return;
      }
      if (streamingConversationIdRef.current !== conversationId) {
        return;
      }
      appendMessageContent(conversationId, artistMessageId, token);
    };

    const onComplete = ({ tokensUsed }: { tokensUsed: number }) => {
      updateMessage(conversationId, artistMessageId, {
        status: 'complete',
        metadata: { tokensUsed }
      });
      incrementUsage(tokensUsed);
      isStreamingRef.current = false;
      activeMessageIdRef.current = null;
      streamingConversationIdRef.current = null;
      isCancelledRef.current = false;
      cancelRef.current = null;
      runNext();
    };

    const onError = (error: Error) => {
      console.error('[Chat] Generation failed:', error.message);
      updateMessage(conversationId, artistMessageId, { status: 'error' });
      isStreamingRef.current = false;
      activeMessageIdRef.current = null;
      streamingConversationIdRef.current = null;
      isCancelledRef.current = false;
      cancelRef.current = null;
      runNext();
    };

    const rawCancel = USE_MOCK_LLM
      ? streamMockReply({
          systemPrompt,
          userTurn,
          language,
          modeFewShots,
          modeId,
          onToken,
          onComplete,
          onError
        })
      : streamClaudeResponse({
          systemPrompt,
          messages: [...history, { role: 'user', content: userTurn }],
          onToken,
          onComplete,
          onError
        });

    cancelRef.current = () => {
      isCancelledRef.current = true;
      rawCancel();
    };
  }, [appendMessageContent, conversationId, incrementUsage, updateMessage]);

  const sendMessage = (text: string): ChatError | null => {
    const trimmed = text.trim();
    if (!trimmed || !conversationId || !currentConversation || !currentArtist) {
      return null;
    }
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      return { code: 'messageTooLong', maxLength: MAX_MESSAGE_LENGTH };
    }

    const now = new Date().toISOString();
    const userMessage: Message = {
      id: generateId('msg'),
      conversationId,
      role: 'user',
      content: trimmed,
      status: 'complete',
      timestamp: now
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
    const priorMessages = getMessages(conversationId);
    const systemPrompt = buildSystemPrompt(modeId);
    const history = formatConversationHistory(priorMessages);

    queueRef.current.push({
      artistMessageId,
      userTurn: trimmed,
      systemPrompt,
      history,
      language: currentConversation.language,
      modeFewShots,
      modeId
    });
    runNext();

    updateConversation(conversationId, {
      lastMessagePreview: trimmed,
      title: trimmed.slice(0, 30)
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
