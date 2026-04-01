import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../i18n';
import type { GameType } from '../types';
import type { Message } from '../../models/Message';
import type { ChatSendPayload } from '../../models/ChatSendPayload';
import type { ChatError } from '../../models/ChatError';
import { generateId } from '../../utils/generateId';
import { useStore } from '../../store/useStore';
import { streamClaudeResponse, type ClaudeMessage } from '../../services/claudeApiService';
import { fetchGameGreetingFromApi } from '../services/gameGreetingService';

interface UseGameCompanionChatParams {
  artistId: string;
  artistName: string | null;
  gameId: string | null;
  gameType: GameType;
  gameLabel: string;
  enabled: boolean;
}

interface UseGameCompanionChatResult {
  conversationId: string;
  messages: Message[];
  isGreetingBooting: boolean;
  isStreaming: boolean;
  tailFollowSignal: number;
  sendFromComposer: (payload: ChatSendPayload) => ChatError | null;
  clear: () => void;
}

function formatArtistDisplayName(artistName: string | null): string {
  if (!artistName) {
    return t('chatDefaultArtistName');
  }

  if (artistName === 'Cathy Gauthier') {
    return t('chatDefaultArtistName');
  }

  return artistName;
}

function buildFallbackGameGreeting(language: string, artistName: string | null, preferredName: string | null, gameLabel: string): string {
  const baseTemplate = t('gameCompanionGreetingFallback')
    .replace('{{artist}}', formatArtistDisplayName(artistName))
    .replace('{{game}}', gameLabel);

  const normalizedPreferredName = typeof preferredName === 'string' ? preferredName.trim() : '';
  if (!normalizedPreferredName) {
    return baseTemplate;
  }

  const isEnglish = language.toLowerCase().startsWith('en');
  if (isEnglish) {
    return `Hey ${normalizedPreferredName}. ${baseTemplate}`;
  }

  return `Salut ${normalizedPreferredName}. ${baseTemplate}`;
}

function toClaudeHistory(messages: Message[]): ClaudeMessage[] {
  return messages
    .filter((message) => message.status === 'complete')
    .map(
      (message): ClaudeMessage => ({
        role: message.role === 'artist' ? 'assistant' : 'user',
        content: message.content.trim()
      })
    )
    .filter((message) => message.content.length > 0)
    .slice(-24);
}

function resolveSessionGreetingKey(artistId: string, gameType: GameType, gameId: string | null): string {
  if (gameId) {
    return `game:${gameType}:${gameId}`;
  }
  return `idle:${gameType}:${artistId}`;
}

export function useGameCompanionChat(params: UseGameCompanionChatParams): UseGameCompanionChatResult {
  const language = useStore((state) => state.language);
  const preferredName = useStore((state) => state.userProfile?.preferredName ?? null);
  const accessToken = useStore((state) => state.session?.accessToken ?? '');
  const incrementUsage = useStore((state) => state.incrementUsage);

  const conversationId = useMemo(
    () => (params.gameId ? `game-companion:${params.gameType}:${params.gameId}` : `game-companion:${params.gameType}:idle`),
    [params.gameId, params.gameType]
  );

  const [messages, setMessages] = useState<Message[]>([]);
  const [isGreetingBooting, setIsGreetingBooting] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [tailFollowSignal, setTailFollowSignal] = useState(0);

  const greetedGameIdsRef = useRef<Set<string>>(new Set());
  const activeSessionKeyRef = useRef<string | null>(null);
  const streamCancelRef = useRef<null | (() => void)>(null);
  const messagesRef = useRef<Message[]>([]);
  const isStreamingRef = useRef(false);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const clearStream = useCallback(() => {
    if (streamCancelRef.current) {
      streamCancelRef.current();
      streamCancelRef.current = null;
    }
    isStreamingRef.current = false;
    setIsStreaming(false);
  }, []);

  const clear = useCallback(() => {
    clearStream();
    setMessages([]);
    setIsGreetingBooting(false);
    setTailFollowSignal(0);
  }, [clearStream]);

  useEffect(
    () => () => {
      clearStream();
    },
    [clearStream]
  );

  useEffect(() => {
    if (!params.enabled) {
      activeSessionKeyRef.current = null;
      clear();
      return;
    }

    const sessionKey = resolveSessionGreetingKey(params.artistId, params.gameType, params.gameId);
    if (activeSessionKeyRef.current !== sessionKey) {
      activeSessionKeyRef.current = sessionKey;
      clearStream();
      setMessages([]);
      setTailFollowSignal(0);
    }

    if (greetedGameIdsRef.current.has(sessionKey)) {
      return;
    }

    greetedGameIdsRef.current.add(sessionKey);

    let cancelled = false;

    if (!params.gameId) {
      const idleGreeting: Message = {
        id: generateId('msg'),
        conversationId,
        role: 'artist',
        content: buildFallbackGameGreeting(language, params.artistName, preferredName, params.gameLabel),
        status: 'complete',
        timestamp: new Date().toISOString(),
        metadata: {
          injected: true,
          injectedType: 'greeting'
        }
      };
      setMessages([idleGreeting]);
      setTailFollowSignal((previous) => previous + 1);
      setIsGreetingBooting(false);
      return () => {
        cancelled = true;
      };
    }

    setIsGreetingBooting(true);

    void (async () => {
      const apiGreeting = await fetchGameGreetingFromApi({
        artistId: params.artistId,
        language,
        accessToken,
        preferredName,
        recentExperienceName: params.gameLabel
      });

      if (cancelled) {
        return;
      }

      const content =
        apiGreeting ??
        buildFallbackGameGreeting(language, params.artistName, preferredName, params.gameLabel);

      const greetingMessage: Message = {
        id: generateId('msg'),
        conversationId,
        role: 'artist',
        content,
        status: 'complete',
        timestamp: new Date().toISOString(),
        metadata: {
          injected: true,
          injectedType: 'greeting'
        }
      };

      setMessages([greetingMessage]);
      setTailFollowSignal(1);
      setIsGreetingBooting(false);
    })();

    return () => {
      cancelled = true;
      setIsGreetingBooting(false);
    };
  }, [
    accessToken,
    clear,
    clearStream,
    conversationId,
    language,
    params.artistId,
    params.artistName,
    params.enabled,
    params.gameId,
    params.gameLabel,
    preferredName
  ]);

  const sendFromComposer = useCallback(
    (payload: ChatSendPayload): ChatError | null => {
      if (payload.image) {
        return { code: 'imageNotSupportedInGames' };
      }

      const text = payload.text.trim();
      if (!text || !params.enabled || !params.gameId || isStreamingRef.current) {
        return null;
      }

      const userMessage: Message = {
        id: generateId('msg'),
        conversationId,
        role: 'user',
        content: text,
        status: 'complete',
        timestamp: new Date().toISOString()
      };

      const artistMessageId = generateId('msg');
      const artistStreamingMessage: Message = {
        id: artistMessageId,
        conversationId,
        role: 'artist',
        content: '',
        status: 'streaming',
        timestamp: new Date().toISOString()
      };

      const history = toClaudeHistory([...messagesRef.current, userMessage]);

      clearStream();
      isStreamingRef.current = true;
      setIsStreaming(true);
      setTailFollowSignal((previous) => previous + 1);
      setMessages((previous) => [...previous, userMessage, artistStreamingMessage]);

      let streamedText = '';
      const stopStream = streamClaudeResponse({
        artistId: params.artistId,
        modeId: params.gameType,
        language,
        messages: history,
        onToken: (token) => {
          streamedText += token;
          const nextContent = streamedText;
          setMessages((previous) =>
            previous.map((message) =>
              message.id === artistMessageId
                ? {
                    ...message,
                    content: nextContent,
                    status: 'streaming'
                  }
                : message
            )
          );
        },
        onComplete: (usage) => {
          const safeContent = streamedText.trim() || t('gameCompanionErrorGeneric');
          setMessages((previous) =>
            previous.map((message) =>
              message.id === artistMessageId
                ? {
                    ...message,
                    content: safeContent,
                    status: 'complete',
                    metadata: {
                      ...message.metadata,
                      tokensUsed: usage.tokensUsed
                    }
                  }
                : message
            )
          );
          incrementUsage();
          isStreamingRef.current = false;
          setIsStreaming(false);
          setTailFollowSignal((previous) => previous + 1);
          streamCancelRef.current = null;
        },
        onError: (error) => {
          console.error('[useGameCompanionChat] companion stream failed', {
            gameType: params.gameType,
            gameId: params.gameId,
            message: error.message
          });
          setMessages((previous) =>
            previous.map((message) =>
              message.id === artistMessageId
                ? {
                    ...message,
                    content: message.content.trim() || t('gameCompanionErrorGeneric'),
                    status: 'complete'
                  }
                : message
            )
          );
          isStreamingRef.current = false;
          setIsStreaming(false);
          streamCancelRef.current = null;
        }
      });

      streamCancelRef.current = stopStream;
      return null;
    },
    [
      clearStream,
      conversationId,
      incrementUsage,
      language,
      params.artistId,
      params.enabled,
      params.gameId,
      params.gameType
    ]
  );

  return {
    conversationId,
    messages,
    isGreetingBooting,
    isStreaming,
    tailFollowSignal,
    sendFromComposer,
    clear
  };
}
