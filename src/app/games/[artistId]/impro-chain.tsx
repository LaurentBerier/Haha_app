import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { ChatInput } from '../../../components/chat/ChatInput';
import { MessageList } from '../../../components/chat/MessageList';
import { BackButton } from '../../../components/common/BackButton';
import { ScoreBar } from '../../../components/chat/ScoreBar';
import { GameResultPanel } from '../../../components/games/GameResultPanel';
import { useImproChain } from '../../../games/hooks/useImproChain';
import { ImproThemesService } from '../../../games/services/ImproThemesService';
import { shouldGuardGameExit, useGameExitGuard } from '../../../hooks/useGameExitGuard';
import { useHeaderHorizontalInset } from '../../../hooks/useHeaderHorizontalInset';
import { useVoiceConversation } from '../../../hooks/useVoiceConversation';
import { t } from '../../../i18n';
import type { ChatError } from '../../../models/ChatError';
import type { ChatSendPayload } from '../../../models/ChatSendPayload';
import type { Message } from '../../../models/Message';
import type { UserProfile } from '../../../models/UserProfile';
import { useStore } from '../../../store/useStore';
import { theme } from '../../../theme';

function normalizeThemeInput(value: string): string {
  return typeof value === 'string' ? value.trim() : '';
}

function formatUserDisplayName(displayName: string | null, email: string | null): string {
  const trimmed = displayName?.trim();
  if (trimmed) {
    return trimmed;
  }

  const emailPrefix = (email ?? '').split('@')[0]?.trim();
  return emailPrefix || t('chatUserFallbackName');
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

function hashString(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function pick<T>(items: T[], seed: number, offset: number): T {
  if (items.length === 0) {
    throw new Error('pick() received an empty list');
  }

  const candidate = items[(seed + offset) % items.length];
  if (candidate !== undefined) {
    return candidate;
  }

  return items[0] as T;
}

interface ImproTheme {
  id: number;
  type: string;
  titre: string;
  premisse: string;
}

function getErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return '';
  }

  const source = error as { code?: unknown };
  return typeof source.code === 'string' ? source.code : '';
}

function shouldRetryThemeFetch(error: unknown): boolean {
  const code = getErrorCode(error);
  if (!code) {
    return true;
  }

  if (
    code === 'MONTHLY_QUOTA_EXCEEDED' ||
    code === 'RATE_LIMIT_EXCEEDED' ||
    code === 'UNAUTHORIZED' ||
    code === 'INVALID_REQUEST'
  ) {
    return false;
  }

  return true;
}

function normalizeThemeSignature(theme: ImproTheme): string {
  return `${normalizeThemeInput(theme.titre).toLowerCase()}|${normalizeThemeInput(theme.premisse).toLowerCase()}`;
}

function createThemesFingerprint(themes: ImproTheme[]): string {
  return themes.map((theme) => normalizeThemeSignature(theme)).join('::');
}

function mergeUniqueThemes(primary: ImproTheme[], secondary: ImproTheme[]): ImproTheme[] {
  const seen = new Set<string>();
  const merged: ImproTheme[] = [];

  [...primary, ...secondary].forEach((theme) => {
    const signature = normalizeThemeSignature(theme);
    if (!signature || seen.has(signature)) {
      return;
    }
    seen.add(signature);
    merged.push(theme);
  });

  return merged;
}

function toAvoidThemes(themes: ImproTheme[]): string[] {
  return themes.map((theme) => `${theme.titre} - ${theme.premisse}`);
}

function mapImproTurnsToMessages(
  conversationId: string,
  turns: Array<{ role: 'user' | 'artist'; content: string }>,
  streamingContent: string
): Message[] {
  const mappedTurns = turns.map((turn, index) => ({
    id: `${conversationId}:turn:${index}`,
    conversationId,
    role: turn.role,
    content: turn.content,
    status: 'complete' as const,
    timestamp: new Date(2026, 0, 1, 0, 0, index).toISOString()
  }));

  const normalizedStreaming = streamingContent.trim();
  if (!normalizedStreaming) {
    return mappedTurns;
  }

  return [
    ...mappedTurns,
    {
      id: `${conversationId}:streaming`,
      conversationId,
      role: 'artist',
      content: normalizedStreaming,
      status: 'streaming' as const,
      timestamp: new Date(2026, 0, 1, 0, 1, mappedTurns.length).toISOString()
    }
  ];
}

function getAstroTrait(userProfile: UserProfile | null, language: string): string {
  const normalizedSign = normalizeThemeInput(userProfile?.horoscopeSign ?? '').toLowerCase();
  const isEnglish = language.startsWith('en');
  const traitsFr: Record<string, string> = {
    aries: 'ton cote fonceur',
    taurus: 'ton cote tete dure',
    gemini: 'ton cote jasette rapide',
    cancer: 'ton cote emotif',
    leo: 'ton cote showman',
    virgo: 'ton cote perfectionniste',
    libra: 'ton cote diplomate',
    scorpio: 'ton cote intense',
    sagittarius: 'ton cote aventurier',
    capricorn: 'ton cote focus resultat',
    aquarius: 'ton cote rebelle',
    pisces: 'ton cote intuitif',
    belier: 'ton cote fonceur',
    taureau: 'ton cote tete dure',
    gemeaux: 'ton cote jasette rapide',
    lion: 'ton cote showman',
    vierge: 'ton cote perfectionniste',
    balance: 'ton cote diplomate',
    scorpion: 'ton cote intense',
    sagittaire: 'ton cote aventurier',
    capricorne: 'ton cote focus resultat',
    verseau: 'ton cote rebelle',
    poissons: 'ton cote intuitif'
  };
  const traitsEn: Record<string, string> = {
    aries: 'your bold side',
    taurus: 'your stubborn side',
    gemini: 'your fast-talking side',
    cancer: 'your emotional side',
    leo: 'your spotlight side',
    virgo: 'your perfectionist side',
    libra: 'your diplomatic side',
    scorpio: 'your intense side',
    sagittarius: 'your adventurous side',
    capricorn: 'your results-first side',
    aquarius: 'your rebel side',
    pisces: 'your intuitive side',
    belier: 'your bold side',
    taureau: 'your stubborn side',
    gemeaux: 'your fast-talking side',
    lion: 'your spotlight side',
    vierge: 'your perfectionist side',
    balance: 'your diplomatic side',
    scorpion: 'your intense side',
    sagittaire: 'your adventurous side',
    capricorne: 'your results-first side',
    verseau: 'your rebel side',
    poissons: 'your intuitive side'
  };

  if (isEnglish) {
    return traitsEn[normalizedSign] ?? 'your wild card side';
  }
  return traitsFr[normalizedSign] ?? 'ton cote imprenable';
}

function buildFallbackThemes(userProfile: UserProfile | null, language: string, variationSeed = 0): ImproTheme[] {
  const isEnglish = language.startsWith('en');
  const runtimeSalt = Math.floor(Math.random() * 1_000_000_000);
  const seed = hashString(`${Date.now()}|${variationSeed}|${runtimeSalt}`);
  const astroTrait = getAstroTrait(userProfile, language);
  const includeAstroTheme = ((seed >>> 2) % 3) === 0;

  const externalThemes = isEnglish
    ? [
        {
          id: 1,
          type: 'universel',
          titre: 'Granby chaos',
          premisse:
            'At Granby Zoo, your selfie pops the lion gate, and you sprint for cover while tourists scream and security chases you through the snack area.'
        },
        {
          id: 2,
          type: 'universel',
          titre: 'Metro mission',
          premisse:
            'Your OPUS card dies at Berri-UQAM in rush hour, so you improvise fake STM announcements and somehow half the platform starts following your instructions.'
        },
        {
          id: 3,
          type: 'wildcard',
          titre: 'Costco meltdown',
          premisse:
            'At Costco Laval, you cut one checkout line by mistake, then a full cart mutiny breaks out and you are forced to negotiate peace with free sample sausages.'
        },
        {
          id: 5,
          type: 'universel',
          titre: 'Old Quebec stunt',
          premisse:
            'In Old Quebec, you replace a missing tour guide, invent wild historical facts with full confidence, and tourists applaud so hard they ask for your daily tours.'
        },
        {
          id: 6,
          type: 'wildcard',
          titre: 'Jean-Drapeau fail',
          premisse:
            'At Parc Jean-Drapeau, your perfect picnic setup collapses into festival chaos, and your panic speech accidentally turns into a public performance.'
        },
        {
          id: 7,
          type: 'universel',
          titre: 'SAQ emergency',
          premisse:
            'At SAQ Berri, you choose the worst bottle for a fancy dinner, then bluff tasting notes so boldly that everyone nods like you are a certified sommelier.'
        },
        {
          id: 8,
          type: 'wildcard',
          titre: 'IKEA survival',
          premisse:
            'At IKEA Montreal, you get lost between fake kitchens, emerge with six random lamps, and strangers begin betting whether you can find the exit before closing.'
        }
      ]
    : [
        {
          id: 1,
          type: 'universel',
          titre: 'Chaos a Granby',
          premisse:
            'Au Zoo de Granby, ton selfie ouvre la mauvaise porte pis le lion sort; tu cours dans l allee des snacks pendant que tout le monde panique autour de toi.'
        },
        {
          id: 2,
          type: 'universel',
          titre: 'Mission metro',
          premisse:
            'Ta carte OPUS meurt a Berri-UQAM en pleine heure de pointe; tu improvises des annonces STM pis la moitie du quai commence a te suivre.'
        },
        {
          id: 3,
          type: 'wildcard',
          titre: 'Drame au Costco',
          premisse:
            'Au Costco Laval, tu coupes une file par erreur pis ca vire en emeute de paniers; tu negocies la paix avec des bouchées gratuites.'
        },
        {
          id: 5,
          type: 'universel',
          titre: 'Vieux-Quebec',
          premisse:
            'Dans le Vieux-Quebec, tu remplaces une guide absente, tu inventes des anecdotes historiques, pis les touristes veulent te reserver tous les jours.'
        },
        {
          id: 6,
          type: 'wildcard',
          titre: 'Parc en panique',
          premisse:
            'Au Parc Jean-Drapeau, ton pique-nique parfait explose en chaos de festival, pis ton rant de panique devient un numero applaudi.'
        },
        {
          id: 7,
          type: 'universel',
          titre: 'Urgence SAQ',
          premisse:
            'A la SAQ Berri, tu choisis le pire vin pour un souper chic, pis tu bluffes des notes de degustation jusqu a ce que tout le monde te croit.'
        },
        {
          id: 8,
          type: 'wildcard',
          titre: 'Deroute IKEA',
          premisse:
            'Au IKEA Montreal, tu te perds entre deux cuisines fake, tu ressors avec six lampes inutiles, pis des inconnus parient sur ton chemin de sortie.'
        }
      ];

  const selfThemes = isEnglish
    ? [
        {
          id: 101,
          type: 'perso_forte',
          titre: 'My live gamble',
          premisse:
            'You get pulled into my live segment at the last second, and I force you to sell a ridiculous idea so confidently that the audience starts cheering for your chaos.'
        },
        {
          id: 102,
          type: 'perso_forte',
          titre: 'Backstage rescue',
          premisse:
            'You arrive backstage right as my opener collapses, so I drag you on stage and we improvise a fake crisis plan that somehow becomes the funniest part of the night.'
        },
        {
          id: 103,
          type: 'perso_forte',
          titre: 'Astro confession',
          premisse:
            `You jump into my radio bit, and I use ${astroTrait} to spin a wild prediction that turns your awkward moment into a full crowd obsession.`
        }
      ]
    : [
        {
          id: 101,
          type: 'perso_forte',
          titre: 'Mon pari en direct',
          premisse:
            'Tu debarques dans mon segment live a la derniere seconde, pis je te force a vendre une idee ridicule avec aplomb jusqu a ce que la foule embarque.'
        },
        {
          id: 102,
          type: 'perso_forte',
          titre: 'Sauvetage backstage',
          premisse:
            'Tu arrives backstage quand mon ouverture plante, pis je te traine sur scene pour improviser une gestion de crise qui devient le meilleur moment du show.'
        },
        {
          id: 103,
          type: 'perso_forte',
          titre: 'Confession astrologie',
          premisse:
            `Tu rentres dans mon bit de radio, pis j utilise ${astroTrait} pour lancer une prediction absurde qui te transforme en obsession du public.`
        }
      ];

  const astroExternalTheme = isEnglish
    ? {
        id: 201,
        type: 'universel',
        titre: 'Astrology detour',
        premisse:
          `Your astrology side (${astroTrait}) takes over during a normal day, and you turn a tiny inconvenience into a dramatic mission everyone around you must follow.`
      }
    : {
        id: 201,
        type: 'universel',
        titre: 'Detour astrologie',
        premisse:
          `Ton cote astrologie (${astroTrait}) prend toute la place dans une journee ordinaire, pis tu transformes un mini probleme en mission dramatique pour tout le monde.`
      };

  const externalPool = includeAstroTheme ? [...externalThemes, astroExternalTheme] : externalThemes;

  const selectedExternal = mergeUniqueThemes(
    [pick(externalPool, seed, 3)],
    [pick(externalPool, seed, 9), pick(externalPool, seed, 15), pick(externalPool, seed, 21)]
  ).slice(0, 2);

  const selectedSelf = pick(selfThemes, seed, 27);
  const ordered = [selectedExternal[0], selectedSelf, selectedExternal[1]]
    .filter((themeOption): themeOption is ImproTheme => Boolean(themeOption))
    .map((themeOption, index) => ({ ...themeOption, id: index + 1 }));

  return ordered.slice(0, 3);
}

export default function ImproChainScreen() {
  const params = useLocalSearchParams<{ artistId: string }>();
  const artistId = params.artistId ?? '';
  const navigation = useNavigation();
  const headerHorizontalInset = useHeaderHorizontalInset();
  const [hasTypedDraft, setHasTypedDraft] = useState(false);
  const [improTailFollowSignal, setImproTailFollowSignal] = useState(0);
  const [selectedTheme, setSelectedTheme] = useState<ImproTheme | null>(null);
  const [customTheme, setCustomTheme] = useState('');
  const [themeSuggestionNonce, setThemeSuggestionNonce] = useState(0);
  const [suggestedThemes, setSuggestedThemes] = useState<ImproTheme[]>([]);
  const [themesLoading, setThemesLoading] = useState(false);
  const [themesError, setThemesError] = useState(false);
  const lastThemesFingerprintRef = useRef('');
  const avoidThemesRef = useRef<string[]>([]);
  const artists = useStore((state) => state.artists);
  const userProfile = useStore((state) => state.userProfile);
  const sessionUser = useStore((state) => state.session?.user ?? null);
  const language = useStore((state) => state.language);
  const conversationModeEnabled = useStore((state) => state.conversationModeEnabled);
  const setConversationModeEnabled = useStore((state) => state.setConversationModeEnabled);
  const accessToken = useStore((state) => state.session?.accessToken ?? '');
  const artist = useMemo(() => artists.find((candidate) => candidate.id === artistId) ?? null, [artists, artistId]);

  const {
    game,
    turns,
    theme: activeTheme,
    targetUserTurns,
    userTurnsCount,
    streamingContent,
    isStreaming,
    isComplete,
    startGame,
    submitTurn,
    abandon,
    clear
  } = useImproChain(artistId);
  const gameStatus = game?.status ?? 'none';
  const userDisplayName = formatUserDisplayName(sessionUser?.displayName ?? null, sessionUser?.email ?? null);
  const artistDisplayName = formatArtistDisplayName(artist?.name ?? null);
  const improConversationId = `impro-game-${game?.id ?? artistId}`;
  const improMessages = useMemo(
    () => mapImproTurnsToMessages(improConversationId, turns, streamingContent),
    [improConversationId, streamingContent, turns]
  );

  const navigateBackOrGamesHome = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(`/games/${artistId}`);
  }, [artistId]);

  const { runProtectedNavigation } = useGameExitGuard({
    navigation,
    gameStatus: game?.status ?? null,
    title: t('gameAbandon'),
    message: t('gameAbandonConfirmBody'),
    confirmLabel: t('gameAbandon'),
    cancelLabel: t('cancel'),
    onAbandon: () => {
      if (game && game.status !== 'complete' && game.status !== 'abandoned') {
        abandon();
      }
      clear();
    }
  });

  const handleBack = () => {
    if (shouldGuardGameExit(game?.status ?? null)) {
      runProtectedNavigation(navigateBackOrGamesHome);
      return;
    }
    clear();
    navigateBackOrGamesHome();
  };

  useEffect(() => {
    if (gameStatus !== 'none' && gameStatus !== 'abandoned') {
      return;
    }

    if (!accessToken) {
      setThemesLoading(true);
      setThemesError(false);
      return;
    }

    let cancelled = false;
    setThemesLoading(true);
    setThemesError(false);

    const fetchThemes = async () => {
      const fetchWithRetry = async (nonce: number, avoidThemes: string[]): Promise<ImproTheme[]> => {
        try {
          return await ImproThemesService.fetchThemes({
            language,
            userProfile,
            nonce,
            avoidThemes
          });
        } catch (firstError) {
          if (!shouldRetryThemeFetch(firstError)) {
            throw firstError;
          }
          const secondNonce = nonce + 101;
          console.warn('[impro-chain] Theme fetch failed, retrying once', firstError);
          return ImproThemesService.fetchThemes({
            language,
            userProfile,
            nonce: secondNonce,
            avoidThemes
          });
        }
      };

      const firstNonce = Date.now() + themeSuggestionNonce * 997 + 1;
      const firstBatch = await fetchWithRetry(firstNonce, avoidThemesRef.current);

      let mergedThemes = firstBatch;

      if (mergedThemes.length < 3) {
        const secondNonce = firstNonce + 17;
        try {
          const topUpBatch = await fetchWithRetry(secondNonce, [...avoidThemesRef.current, ...toAvoidThemes(mergedThemes)]);
          mergedThemes = mergeUniqueThemes(mergedThemes, topUpBatch);
        } catch (error) {
          console.warn('[impro-chain] Theme top-up fetch failed, keeping first batch', error);
        }
      }

      let nextThemes = mergedThemes.slice(0, 3);
      let nextFingerprint = createThemesFingerprint(nextThemes);

      if (nextThemes.length > 0 && nextFingerprint && nextFingerprint === lastThemesFingerprintRef.current) {
        const retryNonce = firstNonce + 37;
        try {
          const retryBatch = await fetchWithRetry(retryNonce, [...avoidThemesRef.current, ...toAvoidThemes(nextThemes)]);
          const retriedThemes = mergeUniqueThemes(nextThemes, retryBatch).slice(0, 3);
          if (retriedThemes.length > 0) {
            nextThemes = retriedThemes;
            nextFingerprint = createThemesFingerprint(nextThemes);
          }
        } catch (error) {
          console.warn('[impro-chain] Theme retry fetch failed, keeping current themes', error);
        }
      }

      if (cancelled) {
        return;
      }

      setSuggestedThemes(nextThemes);
      setThemesLoading(false);
      if (nextFingerprint) {
        lastThemesFingerprintRef.current = nextFingerprint;
      }
      avoidThemesRef.current = [...toAvoidThemes(nextThemes), ...avoidThemesRef.current].slice(0, 40);
    };

    void fetchThemes().catch((error) => {
      if (cancelled) {
        return;
      }
      console.warn('[impro-chain] API theme generation failed, using local fallback', error);
      const fallbackThemes = buildFallbackThemes(userProfile, language, themeSuggestionNonce);
      const fallbackFingerprint = createThemesFingerprint(fallbackThemes);
      setSuggestedThemes(fallbackThemes);
      setThemesError(true);
      setThemesLoading(false);
      if (fallbackFingerprint) {
        lastThemesFingerprintRef.current = fallbackFingerprint;
      }
      avoidThemesRef.current = [...toAvoidThemes(fallbackThemes), ...avoidThemesRef.current].slice(0, 40);
    });

    return () => {
      cancelled = true;
    };
  }, [accessToken, gameStatus, language, themeSuggestionNonce, userProfile]);

  if (!artist) {
    return (
      <View style={styles.center} testID="impro-invalid-artist">
        <Text style={styles.errorText}>{t('invalidConversation')}</Text>
      </View>
    );
  }

  const normalizedCustomTheme = useMemo(() => normalizeThemeInput(customTheme), [customTheme]);
  const resolvedTheme = useMemo(
    () =>
      normalizedCustomTheme
        ? normalizedCustomTheme
        : selectedTheme
          ? `${selectedTheme.titre} - ${selectedTheme.premisse}`
          : '',
    [normalizedCustomTheme, selectedTheme]
  );
  const showLobby = !game || game.status === 'abandoned';
  const showComposer = Boolean(
    game && !isComplete && game.status !== 'cathy-ending' && userTurnsCount < targetUserTurns
  );
  const showActiveGameView = Boolean(game && !showLobby && !isComplete);
  const sendFromImproComposer = useCallback(
    (payload: ChatSendPayload): ChatError | null => {
      const text = payload.text.trim();

      if (payload.image) {
        return { code: 'imageNotSupportedInImpro' };
      }

      if (!text || isStreaming || game?.status === 'cathy-ending') {
        return null;
      }

      setImproTailFollowSignal((previous) => previous + 1);
      void submitTurn(text).catch((error: unknown) => {
        console.error('[impro-chain] Failed to submit user turn', error);
      });

      return null;
    },
    [game?.status, isStreaming, submitTurn]
  );
  const {
    isListening,
    transcript,
    error: conversationError,
    status: conversationStatus,
    hint: conversationHint,
    pauseListening,
    resumeListening
  } = useVoiceConversation({
    enabled: showComposer && conversationModeEnabled,
    disabled: !showComposer || isStreaming || game?.status === 'cathy-ending',
    hasTypedDraft,
    isPlaying: false,
    onSend: (text) => {
      const normalized = text.trim();
      if (!normalized) {
        return;
      }
      sendFromImproComposer({ text: normalized });
    },
    onStopAudio: () => {
      // No in-bubble voice player in Impro gameplay.
    },
    language,
    fallbackLanguage: language
  });
  const interventionsLeft = useMemo(
    () => Math.max(0, targetUserTurns - userTurnsCount),
    [targetUserTurns, userTurnsCount]
  );

  return (
    <View style={styles.screen}>
      <View style={[styles.topRow, { paddingHorizontal: headerHorizontalInset }]}>
        <BackButton testID="impro-back" onPress={handleBack} />
      </View>
      {showActiveGameView ? (
        <KeyboardAvoidingView
          behavior={Platform.select({ ios: 'padding', default: undefined })}
          style={styles.activeGameContainer}
          keyboardVerticalOffset={88}
          testID="impro-screen"
        >
          <View style={styles.activeGameHeader}>
            <Text style={styles.title}>{t('gameImproTitle')}</Text>
            <Text style={styles.subtitle}>{t('gameImproDescription')}</Text>
            <ScoreBar />
            {game?.error ? <Text style={styles.errorText}>{game.error}</Text> : null}
          </View>
          <View style={styles.activeGamePanel}>
            <View style={styles.metaRow}>
              <Text style={styles.metaText}>
                {t('gameImproInterventionsLabel')} {userTurnsCount}/{targetUserTurns}
              </Text>
              <Text style={styles.metaText}>
                {t('gameImproInterventionsLeftLabel')} {interventionsLeft}
              </Text>
            </View>
            {activeTheme ? (
              <Text style={styles.themePill}>
                {t('gameImproThemeBadge')} {activeTheme}
              </Text>
            ) : null}

            <View style={styles.messageListFrame}>
              <MessageList
                testID="impro-message-list"
                listKey={improConversationId}
                messages={improMessages}
                userDisplayName={userDisplayName}
                artistDisplayName={artistDisplayName}
                showEmptyState={false}
                forceFollowSignal={improTailFollowSignal}
                windowSize={24}
                initialNumToRender={48}
                maxToRenderPerBatch={48}
                removeClippedSubviews={false}
                disableVirtualization
                contentContainerStyle={styles.improMessageListContent}
              />
            </View>

            {game?.status === 'cathy-ending' ? (
              <Text style={styles.statusText}>{t('gameImproCathyEnding')}</Text>
            ) : isStreaming ? (
              <Text style={styles.statusText}>{t('gameImproCathyThinking')}</Text>
            ) : !showComposer ? (
              <Text style={styles.statusText}>{t('gameImproCathyWrapHint')}</Text>
            ) : null}
          </View>

          {showComposer ? (
            <View style={styles.composerDock}>
              <ChatInput
                onSend={sendFromImproComposer}
                disabled={isStreaming || game?.status === 'cathy-ending'}
                conversationMode={{
                  enabled: conversationModeEnabled,
                  isListening,
                  transcript,
                  error: conversationError,
                  micState: conversationStatus,
                  hint: conversationHint,
                  onToggle: () => {
                    setConversationModeEnabled(true);
                  },
                  onPauseListening: pauseListening,
                  onResumeListening: resumeListening,
                  onTypingStateChange: setHasTypedDraft
                }}
              />
            </View>
          ) : null}
        </KeyboardAvoidingView>
      ) : (
        <ScrollView contentContainerStyle={styles.content} style={styles.scroll} testID="impro-screen">
          <Text style={styles.title}>{t('gameImproTitle')}</Text>
          <Text style={styles.subtitle}>{t('gameImproDescription')}</Text>
          <ScoreBar />

          {showLobby ? (
            <View style={styles.lobbyCard}>
              <Text style={styles.lobbyTitle}>{t('gameImproThemeSelectionTitle')}</Text>
              <Text style={styles.lobbyHint}>{t('gameImproThemeSelectionSubtitle')}</Text>

              {themesLoading ? (
                <View style={styles.themesLoadingRow}>
                  <ActivityIndicator size="small" color={theme.colors.neonBlue} />
                  <Text style={styles.themesLoadingText}>{t('gameImproThemesLoading')}</Text>
                </View>
              ) : (
                <View style={styles.themeGrid}>
                  {suggestedThemes.map((themeOption) => {
                    const active =
                      selectedTheme?.id === themeOption.id &&
                      selectedTheme?.titre === themeOption.titre &&
                      !normalizeThemeInput(customTheme);

                    return (
                      <Pressable
                        key={`impro-theme-${themeOption.id}-${themeOption.titre}`}
                        onPress={() => {
                          setSelectedTheme(themeOption);
                          setCustomTheme('');
                        }}
                        style={({ pressed }) => [
                          styles.themeChip,
                          active ? styles.themeChipActive : null,
                          pressed ? styles.buttonPressed : null
                        ]}
                        accessibilityRole="button"
                        testID={`impro-theme-${themeOption.id}`}
                      >
                        <Text style={[styles.themeChipTitle, active ? styles.themeChipLabelActive : null]}>
                          {themeOption.titre}
                        </Text>
                        <Text style={[styles.themeChipPremise, active ? styles.themeChipPremiseActive : null]}>
                          {themeOption.premisse}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              {themesError ? (
                <View style={styles.fallbackRow}>
                  <Text style={styles.fallbackHint}>{t('gameImproThemesFallback')}</Text>
                </View>
              ) : null}

              <Pressable
                onPress={() => {
                  setSelectedTheme(null);
                  setThemeSuggestionNonce((previous) => previous + 1);
                }}
                disabled={themesLoading}
                style={({ pressed }) => [
                  styles.retryButton,
                  pressed ? styles.buttonPressed : null,
                  themesLoading ? styles.disabledButton : null
                ]}
                accessibilityRole="button"
                testID="impro-themes-regenerate"
              >
                <Text style={styles.retryButtonLabel}>{t('gameImproRegenerateThemes')}</Text>
              </Pressable>

              <Text style={styles.customThemeLabel}>{t('gameLobbyTheme')}</Text>
              <TextInput
                value={customTheme}
                onChangeText={(value) => {
                  setCustomTheme(value);
                  setSelectedTheme(null);
                }}
                style={styles.input}
                placeholder={t('gameLobbyThemePlaceholder')}
                placeholderTextColor={theme.colors.textDisabled}
                testID="impro-custom-theme"
              />

              <Pressable
                onPress={() => {
                  void (async () => {
                    try {
                      await startGame(resolvedTheme);
                    } catch (error) {
                      console.error('[impro-chain] Failed to start game', error);
                    }
                  })();
                }}
                disabled={!resolvedTheme}
                style={({ pressed }) => [
                  styles.startButton,
                  pressed ? styles.buttonPressed : null,
                  !resolvedTheme ? styles.disabledButton : null
                ]}
                accessibilityRole="button"
                testID="impro-start"
              >
                <Text style={styles.startLabel}>{t('gameLobbyGoButton')}</Text>
              </Pressable>
            </View>
          ) : null}

          {isComplete && game ? (
            <GameResultPanel
              title={t('gameImproCompleteTitle')}
              subtitle={t('gameImproDescription')}
              scoreLabel={`${userTurnsCount}/${targetUserTurns} ${t('gameImproInterventionsShort')}`}
              replayLabel={t('gameImproReplay')}
              exitLabel={t('gameExit')}
              onReplay={() => {
                clear();
                setHasTypedDraft(false);
                setSelectedTheme(null);
                setCustomTheme('');
                setThemeSuggestionNonce((previous) => previous + 1);
              }}
              onExit={() => {
                clear();
                navigateBackOrGamesHome();
              }}
              testID="impro-result"
            />
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background
  },
  topRow: {
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.xs
  },
  scroll: {
    flex: 1
  },
  content: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xl * 2,
    gap: theme.spacing.sm
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: 23,
    fontWeight: '800'
  },
  subtitle: {
    color: theme.colors.textMuted,
    fontSize: 13,
    fontWeight: '700'
  },
  activeGameContainer: {
    flex: 1,
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.sm
  },
  activeGameHeader: {
    gap: theme.spacing.sm
  },
  activeGamePanel: {
    flex: 1,
    marginTop: theme.spacing.sm,
    borderWidth: 1.3,
    borderColor: theme.colors.border,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.sm,
    gap: theme.spacing.sm
  },
  messageListFrame: {
    flex: 1,
    minHeight: 220
  },
  improMessageListContent: {
    paddingBottom: theme.spacing.sm
  },
  composerDock: {
    marginTop: theme.spacing.sm
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.spacing.xs
  },
  metaText: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700'
  },
  themePill: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: theme.colors.neonBlueSoft,
    borderRadius: 999,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 5,
    color: theme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
    backgroundColor: 'rgba(58, 141, 255, 0.1)'
  },
  statusText: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    fontWeight: '600'
  },
  lobbyCard: {
    borderWidth: 1.4,
    borderColor: theme.colors.neonBlueSoft,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    gap: theme.spacing.sm
  },
  lobbyTitle: {
    color: theme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '800'
  },
  lobbyHint: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    lineHeight: 18
  },
  themeGrid: {
    gap: theme.spacing.xs
  },
  themesLoadingRow: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1.4,
    borderColor: theme.colors.neonBlueSoft,
    backgroundColor: theme.colors.surfaceSunken,
    paddingHorizontal: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs
  },
  themesLoadingText: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    fontWeight: '600'
  },
  themeChip: {
    minHeight: 96,
    borderRadius: 12,
    borderWidth: 1.6,
    borderColor: theme.colors.neonBlueSoft,
    backgroundColor: 'rgba(10, 20, 45, 0.72)',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 10,
    shadowColor: theme.colors.neonBlue,
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4
  },
  themeChipActive: {
    borderColor: theme.colors.neonBlue,
    backgroundColor: 'rgba(58, 141, 255, 0.16)',
    shadowOpacity: 0.42,
    shadowRadius: 12,
    elevation: 6
  },
  themeChipTitle: {
    color: theme.colors.textSecondary,
    fontSize: 15,
    fontWeight: '700'
  },
  themeChipPremise: {
    color: theme.colors.textMuted,
    fontSize: 12,
    lineHeight: 17
  },
  themeChipPremiseActive: {
    color: theme.colors.textSecondary
  },
  themeChipLabelActive: {
    color: theme.colors.textPrimary
  },
  fallbackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm
  },
  fallbackHint: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '600'
  },
  retryButton: {
    borderRadius: 999,
    borderWidth: 1.2,
    borderColor: theme.colors.neonBlueSoft,
    backgroundColor: 'rgba(58, 141, 255, 0.1)',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6
  },
  retryButtonLabel: {
    color: theme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '700'
  },
  customThemeLabel: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  input: {
    borderWidth: 1.2,
    borderColor: theme.colors.border,
    borderRadius: 10,
    backgroundColor: theme.colors.surfaceSunken,
    color: theme.colors.textPrimary,
    fontSize: 14,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.sm
  },
  startButton: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1.4,
    borderColor: theme.colors.neonBlueSoft,
    backgroundColor: theme.colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center'
  },
  startLabel: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '700'
  },
  buttonHover: {
    borderColor: theme.colors.neonBlue
  },
  buttonPressed: {
    opacity: 0.95
  },
  disabledButton: {
    opacity: 0.45
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  errorText: {
    color: theme.colors.error
  }
});
