import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useStore } from '../store/useStore';
import { assemblePrompt } from '../services/personalityEngine';
import { streamMockReply } from '../services/mockLlmService';
import { generateId } from '../utils/generateId';
import type { Message } from '../models/Message';
import type { ChatError } from '../models/ChatError';
import { MAX_MESSAGE_LENGTH } from '../config/constants';

interface StreamJob {
  artistMessageId: string;
  prompt: { systemPrompt: string; userTurn: string };
  language: string;
}

export function useChat(conversationId: string) {
  const addMessage = useStore((state) => state.addMessage);
  const updateMessage = useStore((state) => state.updateMessage);
  const appendMessageContent = useStore((state) => state.appendMessageContent);
  const getMessages = useStore((state) => state.getMessages);
  const incrementUsage = useStore((state) => state.incrementUsage);
  const updateConversation = useStore((state) => state.updateConversation);
  const getSelectedArtist = useStore((state) => state.getSelectedArtist);

  const messages = useStore((state) => state.messagesByConversation[conversationId]?.messages ?? []);
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

    const { artistMessageId, prompt, language } = nextJob;
    isStreamingRef.current = true;
    activeMessageIdRef.current = artistMessageId;
    streamingConversationIdRef.current = conversationId;
    isCancelledRef.current = false;
    const rawCancel = streamMockReply({
      systemPrompt: prompt.systemPrompt,
      userTurn: prompt.userTurn,
      language,
      onToken: (token) => {
        if (isCancelledRef.current) {
          return;
        }
        if (streamingConversationIdRef.current !== conversationId) {
          return;
        }
        appendMessageContent(conversationId, artistMessageId, token);
      },
      onComplete: ({ tokensUsed }) => {
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
      },
      onError: () => {
        updateMessage(conversationId, artistMessageId, { status: 'error' });
        isStreamingRef.current = false;
        activeMessageIdRef.current = null;
        streamingConversationIdRef.current = null;
        isCancelledRef.current = false;
        cancelRef.current = null;
        runNext();
      }
    });
    cancelRef.current = () => {
      isCancelledRef.current = true;
      rawCancel();
    };
  }, [appendMessageContent, conversationId, incrementUsage, updateMessage]);

  const sendMessage = (text: string): ChatError | null => {
    const trimmed = text.trim();
    if (!trimmed || !conversationId) {
      return null;
    }
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      return { code: 'messageTooLong', maxLength: MAX_MESSAGE_LENGTH };
    }

    const artist = getSelectedArtist();
    if (!artist) {
      return null;
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

    const prompt = assemblePrompt({
      artist,
      conversationHistory: getMessages(conversationId),
      userMessage: trimmed,
      language: artist.defaultLanguage
    });

    queueRef.current.push({
      artistMessageId,
      prompt,
      language: artist.defaultLanguage
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
