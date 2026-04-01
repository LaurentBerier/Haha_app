import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import { useStore } from '../../store/useStore';
import { fetchGameGreetingFromApi } from '../services/gameGreetingService';
import type { GameType } from '../types';
import { useGameTts } from './useGameTts';

interface UseGameLaunchGreetingParams {
  artistId: string;
  artistName: string | null;
  gameType: GameType;
  gameLabel: string;
  gameDescription: string;
  enabled: boolean;
}

interface UseGameLaunchGreetingResult {
  isGreetingLoading: boolean;
  greetingText: string;
  isIntroVisible: boolean;
  dismissIntro: () => void;
  playGreetingTtsIfEligible: () => Promise<void>;
}

interface BuildFallbackGameLaunchGreetingParams {
  language: string;
  gameType: GameType;
  gameDescription: string;
}

const FRENCH_INTRO_PATTERNS = [
  /\bsalut\b/i,
  /\bbonjour\b/i,
  /\bcoucou\b/i,
  /\bhey\b/i,
  /\bbienvenue\b/i,
  /\bmoi[, ]+c['’]?est\b/i,
  /\bje m['’]?appelle\b/i,
  /\bje suis cathy\b/i,
  /\bc['’]?est cathy\b/i
];

const ENGLISH_INTRO_PATTERNS = [
  /\bhey\b/i,
  /\bhi\b/i,
  /\bhello\b/i,
  /\bwelcome\b/i,
  /\bi['’]?m cathy\b/i,
  /\bi am cathy\b/i,
  /\bmy name is cathy\b/i,
  /\bthis is cathy\b/i
];

function resolveIntroPatterns(language: string): RegExp[] {
  if (language.toLowerCase().startsWith('fr')) {
    return FRENCH_INTRO_PATTERNS;
  }
  return ENGLISH_INTRO_PATTERNS;
}

function containsIntroPhrase(value: string, language: string): boolean {
  const patterns = resolveIntroPatterns(language);
  return patterns.some((pattern) => pattern.test(value));
}

function sanitizeLaunchGreetingContent(content: string | null, language: string): string {
  if (typeof content !== 'string') {
    return '';
  }

  const normalized = content
    .replace(/\r\n/g, '\n')
    .trim();
  if (!normalized) {
    return '';
  }

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  const withoutIntroParagraphs = paragraphs.filter((paragraph) => !containsIntroPhrase(paragraph, language));
  if (withoutIntroParagraphs.length === 0) {
    return '';
  }

  const sanitized = withoutIntroParagraphs.join('\n\n').trim();
  if (!sanitized || containsIntroPhrase(sanitized, language)) {
    return '';
  }

  return sanitized;
}

function resolveGameExplainLineKey(gameType: GameType): 'gameLaunchGreetingTarotExplain' | 'gameLaunchGreetingVraiExplain' | 'gameLaunchGreetingImproExplain' {
  switch (gameType) {
    case 'tarot-cathy':
      return 'gameLaunchGreetingTarotExplain';
    case 'vrai-ou-invente':
      return 'gameLaunchGreetingVraiExplain';
    case 'impro-chain':
      return 'gameLaunchGreetingImproExplain';
  }
}

function resolveGameJokeLineKey(gameType: GameType): 'gameLaunchGreetingTarotJoke' | 'gameLaunchGreetingVraiJoke' | 'gameLaunchGreetingImproJoke' {
  switch (gameType) {
    case 'tarot-cathy':
      return 'gameLaunchGreetingTarotJoke';
    case 'vrai-ou-invente':
      return 'gameLaunchGreetingVraiJoke';
    case 'impro-chain':
      return 'gameLaunchGreetingImproJoke';
  }
}

export function buildFallbackGameLaunchGreeting(params: BuildFallbackGameLaunchGreetingParams): string {
  const explain = t(resolveGameExplainLineKey(params.gameType)).replace('{{description}}', params.gameDescription);
  const joke = t(resolveGameJokeLineKey(params.gameType));
  const provocation = t('gameLaunchGreetingProvocation');

  return [explain, joke, provocation]
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n\n');
}

export function useGameLaunchGreeting(params: UseGameLaunchGreetingParams): UseGameLaunchGreetingResult {
  const language = useStore((state) => state.language);
  const preferredName = useStore((state) => state.userProfile?.preferredName ?? null);
  const accessToken = useStore((state) => state.session?.accessToken ?? '');
  const { speak } = useGameTts({
    artistId: params.artistId,
    language,
    contextTag: params.gameType
  });

  const [isGreetingLoading, setIsGreetingLoading] = useState<boolean>(params.enabled);
  const [greetingText, setGreetingText] = useState('');
  const [isIntroVisible, setIsIntroVisible] = useState<boolean>(params.enabled);
  const playedGreetingTtsRef = useRef(false);

  useEffect(() => {
    if (!params.enabled) {
      setIsGreetingLoading(false);
      setGreetingText('');
      setIsIntroVisible(false);
      playedGreetingTtsRef.current = false;
      return;
    }

    let cancelled = false;
    setIsGreetingLoading(true);
    setGreetingText('');
    setIsIntroVisible(true);
    playedGreetingTtsRef.current = false;

    void (async () => {
      try {
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

        const fallbackText = buildFallbackGameLaunchGreeting({
          language,
          gameType: params.gameType,
          gameDescription: params.gameDescription
        });

        const sanitizedApiGreeting = sanitizeLaunchGreetingContent(apiGreeting ?? null, language);
        setGreetingText(sanitizedApiGreeting || fallbackText);
      } catch {
        if (cancelled) {
          return;
        }

        setGreetingText(
          buildFallbackGameLaunchGreeting({
            language,
            gameType: params.gameType,
            gameDescription: params.gameDescription
          })
        );
      } finally {
        if (!cancelled) {
          setIsGreetingLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    accessToken,
    language,
    params.artistId,
    params.artistName,
    params.enabled,
    params.gameDescription,
    params.gameLabel,
    params.gameType,
    preferredName
  ]);

  const dismissIntro = useCallback(() => {
    setIsIntroVisible(false);
  }, []);

  const playGreetingTtsIfEligible = useCallback(async () => {
    if (!params.enabled || !isIntroVisible || isGreetingLoading || playedGreetingTtsRef.current) {
      return;
    }

    const normalizedText = greetingText.trim();
    if (!normalizedText) {
      return;
    }

    playedGreetingTtsRef.current = true;
    await speak(normalizedText, `launch-greeting:${params.gameType}:${params.artistId}`);
  }, [
    greetingText,
    isGreetingLoading,
    isIntroVisible,
    params.artistId,
    params.enabled,
    params.gameType,
    speak
  ]);

  return {
    isGreetingLoading,
    greetingText,
    isIntroVisible,
    dismissIntro,
    playGreetingTtsIfEligible
  };
}
