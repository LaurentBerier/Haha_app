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
  variantSeed?: number;
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

const FRENCH_PROVOCATION_PATTERNS = [
  /\bou quoi[, ]*t['’]?as peur\b/i,
  /\bclique\b.*\bon y va\b/i
];

const ENGLISH_PROVOCATION_PATTERNS = [
  /\bunless you['’]?re scared\b/i,
  /\bhit\b.*\blet['’]?s go\b/i
];

const GREETING_MAX_LENGTH = 320;

function pickBySeed<T>(items: readonly T[], seed: number, offset: number): T {
  if (items.length === 0) {
    throw new Error('pickBySeed() received an empty list');
  }

  const index = Math.abs((seed + offset) % items.length);
  const candidate = items[index];
  if (candidate !== undefined) {
    return candidate;
  }

  return items[0] as T;
}

function resolveSeed(seed: number | undefined): number {
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    return Math.floor(seed);
  }

  return Math.floor(Date.now() + Math.random() * 1_000_000_000);
}

function resolveGameEmojiPool(gameType: GameType): string[] {
  switch (gameType) {
    case 'tarot-cathy':
      return ['🔮', '✨', '🃏'];
    case 'vrai-ou-invente':
      return ['🕵️', '🎯', '🤫'];
    case 'impro-chain':
      return ['🎭', '🔥', '🎤'];
  }
}

function hasEmoji(value: string): boolean {
  return /[\u{1F300}-\u{1FAFF}]/u.test(value);
}

function resolveBlockedPatterns(language: string): RegExp[] {
  if (language.toLowerCase().startsWith('fr')) {
    return [...FRENCH_INTRO_PATTERNS, ...FRENCH_PROVOCATION_PATTERNS];
  }
  return [...ENGLISH_INTRO_PATTERNS, ...ENGLISH_PROVOCATION_PATTERNS];
}

function containsBlockedPhrase(value: string, language: string): boolean {
  const patterns = resolveBlockedPatterns(language);
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

  const filteredParagraphs = paragraphs.filter((paragraph) => !containsBlockedPhrase(paragraph, language));
  if (filteredParagraphs.length === 0) {
    return '';
  }

  const reduced = filteredParagraphs.slice(0, 2);
  let sanitized = reduced.join('\n\n').trim();
  if (!sanitized || containsBlockedPhrase(sanitized, language)) {
    return '';
  }

  if (sanitized.length > GREETING_MAX_LENGTH) {
    sanitized = `${sanitized.slice(0, GREETING_MAX_LENGTH - 3).trimEnd()}...`;
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
  const seed = resolveSeed(params.variantSeed);
  const explain = t(resolveGameExplainLineKey(params.gameType)).replace('{{description}}', params.gameDescription);
  const joke = t(resolveGameJokeLineKey(params.gameType));
  const emoji = pickBySeed(resolveGameEmojiPool(params.gameType), seed, 7);
  const lead = pickBySeed([explain, joke], seed, 0);
  const followup = lead === explain ? joke : explain;

  return [`${lead.trim()} ${emoji}`, followup.trim()]
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n\n');
}

function decorateGreetingWithEmoji(text: string, gameType: GameType, seed: number): string {
  const normalized = text.trim();
  if (!normalized || hasEmoji(normalized)) {
    return normalized;
  }

  const emoji = pickBySeed(resolveGameEmojiPool(gameType), seed, 19);
  return `${normalized} ${emoji}`;
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
    const variantSeed = resolveSeed(undefined);
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
          gameDescription: params.gameDescription,
          variantSeed
        });

        const sanitizedApiGreeting = sanitizeLaunchGreetingContent(apiGreeting ?? null, language);
        if (sanitizedApiGreeting) {
          setGreetingText(decorateGreetingWithEmoji(sanitizedApiGreeting, params.gameType, variantSeed));
        } else {
          setGreetingText(fallbackText);
        }
      } catch {
        if (cancelled) {
          return;
        }

        setGreetingText(
          buildFallbackGameLaunchGreeting({
            language,
            gameType: params.gameType,
            gameDescription: params.gameDescription,
            variantSeed
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
