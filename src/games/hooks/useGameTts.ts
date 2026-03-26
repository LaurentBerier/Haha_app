import { useCallback, useRef } from 'react';
import { ARTIST_IDS } from '../../config/constants';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { useTtsPlayback } from '../../hooks/useTtsPlayback';
import { fetchAndCacheVoice } from '../../services/ttsService';
import { useStore } from '../../store/useStore';
import { hasVoiceAccessForAccountType, resolveEffectiveAccountType } from '../../utils/accountTypeUtils';

interface UseGameTtsOptions {
  artistId: string;
  language: string;
  contextTag: 'tarot-cathy' | 'impro-chain' | 'vrai-ou-invente';
}

interface UseGameTtsResult {
  speak: (text: string, eventKey: string) => Promise<void>;
  stop: () => Promise<void>;
}

function normalizeEventKey(value: string): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function useGameTts(options: UseGameTtsOptions): UseGameTtsResult {
  const audioPlayer = useAudioPlayer();
  const { normalizeTtsChunk, resolveVoiceErrorCode } = useTtsPlayback();
  const defaultAccessToken = useStore((state) => state.session?.accessToken ?? '');
  const defaultAccountType = useStore((state) => state.session?.user.accountType ?? null);
  const defaultRole = useStore((state) => state.session?.user.role ?? null);
  const voiceAutoPlay = useStore((state) => state.voiceAutoPlay);
  const spokenEventKeysRef = useRef<Set<string>>(new Set());

  const speak = useCallback(
    async (text: string, eventKey: string) => {
      const normalizedEventKey = normalizeEventKey(eventKey);
      if (!normalizedEventKey || spokenEventKeysRef.current.has(normalizedEventKey)) {
        return;
      }

      const latestState = useStore.getState();
      const latestAccessToken = latestState.session?.accessToken ?? defaultAccessToken;
      const effectiveAccountType = resolveEffectiveAccountType(
        latestState.session?.user.accountType ?? defaultAccountType,
        latestState.session?.user.role ?? defaultRole
      );
      const latestVoiceAutoPlay = latestState.voiceAutoPlay ?? voiceAutoPlay;
      const normalizedText = normalizeTtsChunk(text);

      if (
        options.artistId !== ARTIST_IDS.CATHY_GAUTHIER ||
        !latestVoiceAutoPlay ||
        !hasVoiceAccessForAccountType(effectiveAccountType) ||
        !latestAccessToken.trim() ||
        !normalizedText
      ) {
        return;
      }

      spokenEventKeysRef.current.add(normalizedEventKey);
      try {
        const voiceUri = await fetchAndCacheVoice(
          normalizedText,
          options.artistId,
          options.language,
          latestAccessToken,
          { throwOnError: true }
        );

        if (!voiceUri) {
          return;
        }

        await audioPlayer.playQueue([voiceUri], {
          messageId: `game:${options.contextTag}:${normalizedEventKey}`
        });
      } catch (error) {
        if (__DEV__) {
          console.warn('[useGameTts] tts failed', {
            contextTag: options.contextTag,
            code: resolveVoiceErrorCode(error)
          });
        }
      }
    },
    [
      audioPlayer,
      defaultAccessToken,
      defaultAccountType,
      defaultRole,
      normalizeTtsChunk,
      options.artistId,
      options.contextTag,
      options.language,
      resolveVoiceErrorCode,
      voiceAutoPlay
    ]
  );

  const stop = useCallback(async () => {
    await audioPlayer.stop();
  }, [audioPlayer]);

  return {
    speak,
    stop
  };
}
