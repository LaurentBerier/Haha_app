import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions
} from 'react-native';
import { ChatInput } from '../../../components/chat/ChatInput';
import { MessageList } from '../../../components/chat/MessageList';
import { StreamingIndicator } from '../../../components/chat/StreamingIndicator';
import { AmbientGlow } from '../../../components/common/AmbientGlow';
import { BackButton } from '../../../components/common/BackButton';
import { buildTutorialConversationGreeting } from '../../../constants/tutorialConversationCopy';
import { MODE_IDS } from '../../../config/constants';
import { getVisibleModeNamesForGreeting } from '../../../config/experienceCatalog';
import { MODE_CATEGORY_META, MODE_CATEGORY_ORDER, type ModeCategoryId } from '../../../config/modeCategories';
import { E2E_AUTH_BYPASS, GREETING_FORCE_TUTORIAL } from '../../../config/env';
import { useAutoReplayLastArtistMessage } from '../../../hooks/useAutoReplayLastArtistMessage';
import { resolveChatSendContextFromState } from '../../../hooks/chatSendContext';
import { useChat } from '../../../hooks/useChat';
import { useHeaderHorizontalInset } from '../../../hooks/useHeaderHorizontalInset';
import {
  buildCathyVoiceNotice,
  resolveVoiceErrorCode,
  shouldShowUpgradeForTtsCode,
  type TerminalTtsCode as SharedTerminalTtsCode
} from '../../../hooks/useTtsPlayback';
import { useVoiceConversation } from '../../../hooks/useVoiceConversation';
import { t } from '../../../i18n';
import type { ChatError } from '../../../models/ChatError';
import { normalizeConversationThreadType } from '../../../models/Conversation';
import type { Message } from '../../../models/Message';
import { synthesizeVoice } from '../../../services/voiceEngine';
import { clearTerminalCooldownForPurpose } from '../../../services/ttsService';
import { attemptVoiceAutoplayUri, attemptVoiceAutoplayUriDetailed } from '../../../services/voiceAutoplayService';
import { markWebAutoplaySessionUnlocked, queueLatestWebAutoplayUnlockRetry, clearPendingWebAutoplayUnlockRetry } from '../../../services/webAutoplayUnlockService';
import { tryLaunchExperienceFromText } from '../../../services/experienceLaunchService';
import { getRandomFillerUri, prewarmVoiceFillers } from '../../../services/voiceFillerService';
import { useStore } from '../../../store/useStore';
import { theme } from '../../../theme';
import { hasVoiceAccessForAccountType, resolveEffectiveAccountType } from '../../../utils/accountTypeUtils';
import { deriveGreetingActivityContext } from '../../../utils/greetingActivity';
import { collectArtistMemoryFacts } from '../../../utils/memoryFacts';
import {
  captureModeSelectReplayBarrier,
  deriveMessagesAfterReplayBarrier,
  type ModeSelectReplayBarrier
} from '../../../utils/modeSelectReplayBarrier';
import { shouldSkipModeSelectGreetingInjection } from '../../../utils/modeSelectGreetingDedup';
import { stripAudioTags } from '../../../utils/audioTags';
import { generateId } from '../../../utils/generateId';
import { toVoicePlaybackOutcome } from '../../../utils/voicePlaybackPolicy';
import {
  resolveModeSelectConversationRecoveryAction
} from '../../../utils/modeSelectConversationRecovery';
import {
  findArtistConversationIdForMessageId,
  isValidBoundModeSelectConversation,
  resolveModeSelectBoundConversationId,
  type ModeSelectBoundResolutionReason
} from '../../../utils/modeSelectConversationBinding';
import type { ChatSendPayload } from '../../../models/ChatSendPayload';
import { shouldRestoreModeSelectMicAfterBlur } from '../micRestore';
import { resolveGreetingAutoMicDecision } from '../greetingAutoMic';
import { shouldAutoPlayGreetingVoice, shouldAutoPlayPendingGreetingVoice } from '../greetingAutoplayPolicy';
import {
  shouldInsertGreetingFallbackAfterFailure,
  shouldRecoverGreetingBootstrapConversation
} from '../greetingBootstrapRecovery';
import { fetchModeSelectGreetingFromApi, type GreetingCoordinates } from '../greetingService';

interface PendingGreetingAudio {
  conversationId: string;
  uri: string;
  messageId: string;
  forceAutoplay: boolean;
}

type ModeSelectRuntimeRebindReason =
  | ModeSelectBoundResolutionReason
  | 'artist_changed'
  | 'send_recovery'
  | 'audio_mismatch';

interface OptionalLocationModule {
  Accuracy?: {
    Balanced?: number;
    Low?: number;
    Lowest?: number;
  };
  getForegroundPermissionsAsync: () => Promise<{ granted?: boolean; status?: string }>;
  getCurrentPositionAsync: (options?: {
    accuracy?: number;
    maximumAge?: number;
    timeout?: number;
  }) => Promise<{ coords?: { latitude?: number; longitude?: number } }>;
}

let cachedLocationModule: OptionalLocationModule | null | undefined;
const GREETING_BOOTING_ROTATION_MS = 1_200;
const GREETING_BOOTING_FR_LINES = [
  "Chargement du cerveau de Cathy... attention, y'a du trafic",
  "Calibration du sarcasme... 92%... 104%... ok c'est trop tard",
  "Synchronisation avec ton sens de l'humour... erreur detectee",
  "Injection d'opinions non sollicitees... en cours"
] as const;
const MODE_SELECT_DEBUG_TOGGLE_KEY = 'HAHA_MODE_SELECT_DEBUG';
const GREETING_AUTOPLAY_MAX_ATTEMPTS = 3;
const GREETING_AUTOPLAY_RETRY_DELAY_MS = 0;

type TerminalTtsCode = SharedTerminalTtsCode;
type GreetingVoiceNoticeCode = TerminalTtsCode | 'UNAUTHORIZED' | 'TTS_PROVIDER_ERROR';

function parseDebugToggleValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
    return null;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    if (normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes') {
      return true;
    }
    if (normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no') {
      return false;
    }
  }
  return null;
}

function isModeSelectDebugLoggingEnabled(): boolean {
  if (!__DEV__) {
    return false;
  }

  const globalObject = globalThis as Record<string, unknown>;
  const globalToggle = parseDebugToggleValue(globalObject.__HAHA_MODE_SELECT_DEBUG__);
  if (globalToggle !== null) {
    return globalToggle;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  try {
    const params = new URLSearchParams(window.location.search);
    const queryToggle = parseDebugToggleValue(params.get('modeSelectDebug') ?? params.get('msdebug'));
    if (queryToggle !== null) {
      return queryToggle;
    }
  } catch {
    // Ignore URL parsing errors in non-browser runtimes.
  }

  try {
    const storageToggle = parseDebugToggleValue(window.localStorage?.getItem(MODE_SELECT_DEBUG_TOGGLE_KEY));
    if (storageToggle !== null) {
      return storageToggle;
    }
  } catch {
    // Ignore storage access errors (private mode / non-browser runtime).
  }

  return false;
}

function logModeSelectDebugTrace(event: string, payload: Record<string, unknown> = {}): void {
  if (!isModeSelectDebugLoggingEnabled()) {
    return;
  }

  console.log('[mode-select] trace', {
    event,
    ts: Date.now(),
    ...payload
  });
}

function isGreetingTerminalTtsCode(value: string): value is TerminalTtsCode {
  return value === 'TTS_QUOTA_EXCEEDED' || value === 'RATE_LIMIT_EXCEEDED' || value === 'TTS_FORBIDDEN';
}

function buildCathyVoiceUnavailableNotice(code: GreetingVoiceNoticeCode): string {
  if (code === 'RATE_LIMIT_EXCEEDED' || code === 'TTS_QUOTA_EXCEEDED' || code === 'TTS_FORBIDDEN') {
    return buildCathyVoiceNotice(code);
  }
  if (code === 'UNAUTHORIZED') {
    return t('cathyVoiceAuthRequiredMessage');
  }
  return t('cathyVoiceUnavailableMessage');
}

function resolveGreetingVoiceNoticeCode(errorCode: string): GreetingVoiceNoticeCode {
  const normalized = errorCode.trim();
  if (isGreetingTerminalTtsCode(normalized)) {
    return normalized;
  }
  if (normalized === 'UNAUTHORIZED') {
    return 'UNAUTHORIZED';
  }
  return 'TTS_PROVIDER_ERROR';
}

function shouldRetryGreetingAutoplayFailure(failureReason: string | null): boolean {
  return failureReason === 'interrupted' || failureReason === 'playback_error';
}

async function attemptGreetingAutoplayWithRetries(params: {
  audioPlayer: Parameters<typeof attemptVoiceAutoplayUriDetailed>[0]['audioPlayer'];
  uri: string;
  messageId: string;
}): Promise<ReturnType<typeof toVoicePlaybackOutcome>> {
  let lastOutcome: ReturnType<typeof toVoicePlaybackOutcome> = {
    state: 'failed',
    failureReason: 'playback_error'
  };

  for (let attempt = 1; attempt <= GREETING_AUTOPLAY_MAX_ATTEMPTS; attempt += 1) {
    const playbackOutcome = toVoicePlaybackOutcome(
      await attemptVoiceAutoplayUriDetailed({
        audioPlayer: params.audioPlayer,
        uri: params.uri,
        messageId: params.messageId
      })
    );
    lastOutcome = playbackOutcome;
    if (playbackOutcome.state !== 'failed') {
      return playbackOutcome;
    }
    if (!shouldRetryGreetingAutoplayFailure(playbackOutcome.failureReason)) {
      return playbackOutcome;
    }
    if (attempt >= GREETING_AUTOPLAY_MAX_ATTEMPTS) {
      return playbackOutcome;
    }
    if (GREETING_AUTOPLAY_RETRY_DELAY_MS > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, GREETING_AUTOPLAY_RETRY_DELAY_MS);
      });
    }
  }

  return lastOutcome;
}

interface ArtistModeSource {
  id: string;
  name?: string;
  supportedModeIds?: string[];
  supportedLanguages?: string[];
  defaultLanguage?: string;
}

function toFirstName(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const withoutEmailHost = trimmed.includes('@') ? trimmed.split('@')[0] ?? '' : trimmed;
  const firstToken = withoutEmailHost
    .split(/\s+/)
    .map((token) => token.trim())
    .find(Boolean);
  return firstToken ? firstToken.slice(0, 32) : null;
}

function resolveGreetingPreferredName(params: {
  profilePreferredName?: string | null;
  displayName?: string | null;
  email?: string | null;
}): string | null {
  return (
    toFirstName(params.profilePreferredName ?? null) ??
    toFirstName(params.displayName ?? null) ??
    toFirstName(params.email ?? null)
  );
}

function classifyGreetingNameStyle(preferredName: string | null | undefined): 'normal' | 'unusual' {
  if (typeof preferredName !== 'string') {
    return 'normal';
  }

  const normalized = preferredName.trim().slice(0, 40);
  if (!normalized) {
    return 'normal';
  }

  const compact = normalized.replace(/\s+/g, '');
  if (compact.length >= 15) {
    return 'unusual';
  }

  if (/\d/.test(compact)) {
    return 'unusual';
  }

  if (/[^A-Za-zÀ-ÖØ-öø-ÿ'’\- ]/.test(normalized)) {
    return 'unusual';
  }

  if (/(.)\1\1/i.test(compact)) {
    return 'unusual';
  }

  const lettersOnly = compact.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, '');
  if (lettersOnly.length >= 4) {
    const upperCount = (lettersOnly.match(/[A-ZÀ-ÖØ-Þ]/g) ?? []).length;
    const lowerCount = (lettersOnly.match(/[a-zà-öø-ÿ]/g) ?? []).length;
    const hasAggressiveMixedCase =
      /[a-zà-öø-ÿ][A-ZÀ-ÖØ-Þ]/.test(lettersOnly) || /[A-ZÀ-ÖØ-Þ]{2,}[a-zà-öø-ÿ]/.test(lettersOnly);
    if (upperCount > 0 && lowerCount > 0 && (hasAggressiveMixedCase || upperCount >= Math.ceil(lettersOnly.length * 0.6))) {
      return 'unusual';
    }
  }

  return 'normal';
}

function resolveGreetingConversationLanguage(artist: ArtistModeSource, preferredLanguage: string): string {
  const supportedLanguages = Array.isArray(artist.supportedLanguages) ? artist.supportedLanguages : [];
  if (supportedLanguages.includes(preferredLanguage)) {
    return preferredLanguage;
  }

  const preferredFamily = preferredLanguage.toLowerCase().split('-')[0];
  if (preferredFamily) {
    const familyMatch = supportedLanguages.find((candidate) => candidate.toLowerCase().startsWith(preferredFamily));
    if (familyMatch) {
      return familyMatch;
    }
  }

  return artist.defaultLanguage?.trim() || preferredLanguage;
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

function pickRandom<T>(values: T[]): T {
  if (values.length === 0) {
    throw new Error('pickRandom requires at least one value.');
  }
  const index = Math.floor(Math.random() * values.length);
  return values[index] ?? values[0]!;
}

function pickGreetingVariant(variants: string[], lastGreetingSnippet: string | null): string {
  if (variants.length === 0) {
    return '';
  }

  const normalizedSnippet = typeof lastGreetingSnippet === 'string' ? lastGreetingSnippet.toLowerCase() : '';
  const pool =
    normalizedSnippet.length > 0
      ? variants.filter((entry) => !normalizedSnippet.includes(entry.toLowerCase()))
      : variants;
  const selectedPool = pool.length > 0 ? pool : variants;
  return pickRandom(selectedPool);
}

function buildFallbackGreetingText(
  artist: ArtistModeSource,
  language: string,
  preferredName: string | null,
  _availableModes: string[],
  isTutorialGreeting: boolean,
  options?: {
    recentActivityFacts?: string[];
    askActivityFeedback?: boolean;
    lastGreetingSnippet?: string | null;
    recentExperienceName?: string | null;
    recentExperienceType?: 'mode' | 'game' | null;
    activityFeedbackCue?: string | null;
  }
): string {
  const isEnglish = language.toLowerCase().startsWith('en');
  const displayName = preferredName ?? (isEnglish ? 'there' : 'toi');
  const nameStyle = classifyGreetingNameStyle(preferredName);
  const artistName = artist.name?.trim() || 'Cathy';
  const isCathyArtist = artistName.toLowerCase().includes('cathy');
  const recentActivityFacts = Array.isArray(options?.recentActivityFacts)
    ? options.recentActivityFacts
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .slice(0, 2)
    : [];
  const askActivityFeedback = options?.askActivityFeedback === true;
  const lastGreetingSnippet = options?.lastGreetingSnippet ?? null;
  const recentExperienceName =
    typeof options?.recentExperienceName === 'string' && options.recentExperienceName.trim()
      ? options.recentExperienceName.trim()
      : null;
  const recentExperienceType =
    options?.recentExperienceType === 'mode' || options?.recentExperienceType === 'game'
      ? options.recentExperienceType
      : null;
  const activityFeedbackCue =
    typeof options?.activityFeedbackCue === 'string' && options.activityFeedbackCue.trim()
      ? options.activityFeedbackCue.trim()
      : null;
  const explicitRecentExperienceFact =
    recentExperienceName && recentExperienceType
      ? isEnglish
        ? `You just came back from ${recentExperienceName}.`
        : recentExperienceType === 'game'
          ? `Tu reviens du jeu ${recentExperienceName}.`
          : `Tu reviens de ${recentExperienceName}.`
      : null;
  const hasRecentActivity = recentActivityFacts.length > 0 || Boolean(explicitRecentExperienceFact);

  if (isTutorialGreeting) {
    return buildTutorialConversationGreeting(language, preferredName, nameStyle);
  }

  if (isEnglish) {
    const openingVariants = [
      `Hey ${displayName}, how's it going? It's ${artistName}.`,
      `Hi ${displayName}, doing okay? ${artistName} here, still caffeinated.`,
      `Yo ${displayName}, how are you? It's ${artistName}, still loud in a useful way.`
    ];
    const activityFollowUpVariants = [
      "Did you like that vibe, or should we crank it differently this time?",
      'Did that land for you, or do you want a different angle now?'
    ];
    const feedbackQuestion = askActivityFeedback
      ? activityFeedbackCue ?? pickGreetingVariant(activityFollowUpVariants, lastGreetingSnippet)
      : null;
    const onboardingVariants = hasRecentActivity
      ? [
          "Tell me where you want to pick this up and we'll keep rolling.",
          'Give me your next move and I will follow your energy.'
        ]
      : [
          "Drop one short line and I'll take it from there.",
          "Keep it simple: tell me your vibe and we'll roll.",
          "Start anywhere, I'll adapt fast."
        ];

    return [
      pickGreetingVariant(openingVariants, lastGreetingSnippet),
      hasRecentActivity ? recentActivityFacts.join(' ') : explicitRecentExperienceFact,
      feedbackQuestion,
      pickGreetingVariant(onboardingVariants, lastGreetingSnippet)
    ]
      .filter(Boolean)
      .join(' ');
  }

  const openingVariants = isCathyArtist
    ? [
        `Hey ${displayName}, ca va? J'suis le clone de Cathy, version nerveuse.`,
        `Salut ${displayName}, tu vas bien? J'suis le clone de Cathy, meme repartie.`,
        `Yo ${displayName}, comment ca roule? Clone de Cathy au rapport, sarcasme inclus.`,
        `Salut ${displayName}, pret(e)? J'suis le clone de Cathy, version turbo.`,
        `Bon ${displayName}, on part ca? Clone de Cathy, leger glitch d'attitude.`
      ]
    : [
        `Hey ${displayName}, ca va? J'suis ${artistName}.`,
        `Salut ${displayName}, tu vas bien? Moi c'est ${artistName}.`,
        `Yo ${displayName}, comment ca roule? C'est ${artistName}, on part ca.`
      ];
  const activityFollowUpVariants = [
    "T'as aime ca, ou tu veux qu'on tourne ca autrement?",
    "T'as aime l'ambiance, ou tu veux qu'on change le ton?"
  ];
  const feedbackQuestion = askActivityFeedback
    ? activityFeedbackCue ?? pickGreetingVariant(activityFollowUpVariants, lastGreetingSnippet)
    : null;
  const onboardingVariants = hasRecentActivity
    ? ["Dis-moi ou tu veux reprendre, pis j'embarque.", "Lance ta prochaine idee, pis on continue."]
    : ['Aucune pression, lance juste une phrase.', "On garde ca simple, dis-moi ton mood.", "Commence ou t'veux, j'm'ajuste vite."];

  return [
    pickGreetingVariant(openingVariants, lastGreetingSnippet),
    hasRecentActivity ? recentActivityFacts.join(' ') : explicitRecentExperienceFact,
    feedbackQuestion,
    pickGreetingVariant(onboardingVariants, lastGreetingSnippet)
  ]
    .filter(Boolean)
    .join(' ');
}

function buildAvailableModesForGreeting(artist: ArtistModeSource, language: string): string[] {
  return getVisibleModeNamesForGreeting(artist.id, language).slice(0, 10);
}

async function getOptionalCoords(): Promise<GreetingCoordinates | null> {
  if (Platform.OS === 'web') {
    return null;
  }

  if (cachedLocationModule === undefined) {
    try {
      const loaded = await import('expo-location');
      cachedLocationModule = loaded as OptionalLocationModule;
    } catch {
      cachedLocationModule = null;
    }
  }

  const locationModule = cachedLocationModule;
  if (!locationModule) {
    return null;
  }

  try {
    const permission = await locationModule.getForegroundPermissionsAsync();
    if (!permission.granted) {
      return null;
    }

    const accuracy =
      locationModule.Accuracy?.Balanced ?? locationModule.Accuracy?.Low ?? locationModule.Accuracy?.Lowest;

    const position = await locationModule.getCurrentPositionAsync({
      ...(typeof accuracy === 'number' ? { accuracy } : {}),
      maximumAge: 60_000,
      timeout: 5_000
    });

    const latitude = position.coords?.latitude;
    const longitude = position.coords?.longitude;
    if (
      typeof latitude !== 'number' ||
      !Number.isFinite(latitude) ||
      typeof longitude !== 'number' ||
      !Number.isFinite(longitude)
    ) {
      return null;
    }

    return { lat: latitude, lon: longitude };
  } catch {
    return null;
  }
}

interface CategoryMenuButtonProps {
  artistId: string;
  id: ModeCategoryId;
  index: number;
  compactProgress: Animated.Value;
  isCompact: boolean;
}

function CategoryMenuButton({ artistId, id, index, compactProgress, isCompact }: CategoryMenuButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const cardHeight = compactProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [118, 56]
  });
  const cardRadius = compactProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [16, 9]
  });
  const borderWidth = compactProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1.7, 1.05]
  });
  const labelFontSize = compactProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [16, 9.5]
  });
  const labelLineHeight = compactProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [20, 10.5]
  });
  const emojiScale = compactProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.52]
  });

  useEffect(() => {
    const breathing = Animated.loop(
      Animated.sequence([
        Animated.delay(index * 120),
        Animated.timing(glow, {
          toValue: 1,
          duration: 950,
          useNativeDriver: false
        }),
        Animated.timing(glow, {
          toValue: 0,
          duration: 950,
          useNativeDriver: false
        })
      ])
    );
    breathing.start();
    return () => breathing.stop();
  }, [glow, index]);

  const handlePressIn = () => {
    Animated.spring(scale, {
      toValue: 0.96,
      friction: 8,
      tension: 180,
      useNativeDriver: false
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      friction: 7,
      tension: 120,
      useNativeDriver: false
    }).start();
  };

  const backgroundColor = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.colors.surface, theme.colors.surfaceRaised]
  });

  const shadowOpacity = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [0.14, 0.34]
  });

  const borderColor = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.colors.border, theme.colors.neonBlue]
  });

  return (
    <Animated.View
      style={[
        styles.categoryCard,
        isCompact ? styles.categoryCardCompact : styles.categoryCardExpanded,
        {
          height: cardHeight,
          transform: [{ scale }],
          backgroundColor,
          shadowOpacity,
          borderColor,
          borderRadius: cardRadius,
          borderWidth
        }
      ]}
      testID={`mode-category-container-${id}`}
    >
      <Pressable
        testID={`mode-category-${id}`}
        style={({ pressed }) => [
          styles.categoryPressable,
          pressed ? styles.categoryPressablePressed : null
        ]}
        onPress={() => router.push(`/mode-select/${artistId}/${id}`)}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        accessibilityRole="button"
      >
        <Animated.View style={{ transform: [{ scale: emojiScale }] }}>
          <Text style={styles.categoryEmoji}>{MODE_CATEGORY_META[id].emoji}</Text>
        </Animated.View>
        <Animated.Text
          style={[styles.categoryLabel, { fontSize: labelFontSize, lineHeight: labelLineHeight }]}
          numberOfLines={isCompact ? 2 : 1}
        >
          {t(MODE_CATEGORY_META[id].labelKey)}
        </Animated.Text>
      </Pressable>
    </Animated.View>
  );
}

export default function ModeSelectHomeScreen() {
  const params = useLocalSearchParams<{ artistId: string }>();
  const artistId = params.artistId ?? '';
  const navigation = useNavigation();
  const { height: viewportHeight } = useWindowDimensions();
  const headerHorizontalInset = useHeaderHorizontalInset();
  const [greeting, setGreeting] = useState<string | null>(null);
  const [hasTypedDraft, setHasTypedDraft] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isModeSelectScreenFocused, setIsModeSelectScreenFocused] = useState(true);
  const [pendingAutoMicGreetingMessageId, setPendingAutoMicGreetingMessageId] = useState<string | null>(null);
  const [categoryGridBottomY, setCategoryGridBottomY] = useState<number | null>(null);
  const [isGreetingBooting, setIsGreetingBooting] = useState(false);
  const [greetingOpenCycle, setGreetingOpenCycle] = useState(0);
  const [replayBarrier, setReplayBarrier] = useState<ModeSelectReplayBarrier | null>(null);
  const [greetingBootingLineIndex, setGreetingBootingLineIndex] = useState(() =>
    Math.floor(Math.random() * GREETING_BOOTING_FR_LINES.length)
  );

  const artists = useStore((state) => state.artists);
  const language = useStore((state) => state.language);
  const accessToken = useStore((state) => state.session?.accessToken ?? '');
  const sessionUser = useStore((state) => state.session?.user ?? null);
  const userProfile = useStore((state) => state.userProfile);
  const activeConversationId = useStore((state) => state.activeConversationId);
  const conversationModeEnabled = useStore((state) => state.conversationModeEnabled);
  const setConversationModeEnabled = useStore((state) => state.setConversationModeEnabled);
  const voiceAutoPlay = useStore((state) => state.voiceAutoPlay);
  const createConversation = useStore((state) => state.createConversation);
  const setActiveConversation = useStore((state) => state.setActiveConversation);
  const addMessage = useStore((state) => state.addMessage);
  const updateMessage = useStore((state) => state.updateMessage);
  const updateConversation = useStore((state) => state.updateConversation);
  const markArtistGreeted = useStore((state) => state.markArtistGreeted);
  const setModeSelectSessionHubConversation = useStore((state) => state.setModeSelectSessionHubConversation);
  const hasArtistBeenGreetedThisSession = useStore(
    useCallback((state) => state.greetedArtistIds.has(artistId), [artistId])
  );
  const conversationsForArtist = useStore(
    useCallback((state) => state.conversations[artistId] ?? [], [artistId])
  );
  const artist = useMemo(() => artists.find((candidate) => candidate.id === artistId) ?? null, [artists, artistId]);
  const effectiveAccountType = useMemo(
    () => resolveEffectiveAccountType(sessionUser?.accountType ?? null, sessionUser?.role ?? null),
    [sessionUser?.accountType, sessionUser?.role]
  );
  const preferredName = useMemo(
    () =>
      resolveGreetingPreferredName({
        profilePreferredName: userProfile?.preferredName ?? null,
        displayName: sessionUser?.displayName ?? null,
        email: sessionUser?.email ?? null
      }),
    [sessionUser?.displayName, sessionUser?.email, userProfile?.preferredName]
  );
  const isGreetingGateSatisfied = E2E_AUTH_BYPASS || hasArtistBeenGreetedThisSession;
  const [boundConversationId, setBoundConversationId] = useState('');
  const boundConversationIdRef = useRef('');
  const modeSelectScreenFocusedRef = useRef(true);
  const modeSelectConversationIdRef = useRef('');
  const lastBoundArtistIdRef = useRef<string | null>(null);
  const resolvedBoundConversation = useMemo(
    () =>
      resolveModeSelectBoundConversationId({
        artistId,
        isGreetingGateSatisfied,
        boundConversationId,
        activeConversationId,
        conversationsForArtist
      }),
    [activeConversationId, artistId, boundConversationId, conversationsForArtist, isGreetingGateSatisfied]
  );
  const modeSelectConversationId = boundConversationId;
  const modeSelectConversation = useMemo(
    () => conversationsForArtist.find((conversation) => conversation.id === modeSelectConversationId) ?? null,
    [conversationsForArtist, modeSelectConversationId]
  );
  const modeSelectConversationLanguage = useMemo(
    () => (modeSelectConversation?.language?.trim() ? modeSelectConversation.language : language),
    [language, modeSelectConversation?.language]
  );
  const userDisplayName = formatUserDisplayName(sessionUser?.displayName ?? null, sessionUser?.email ?? null);
  const artistDisplayName = formatArtistDisplayName(artist?.name ?? null);
  const [pendingGreetingAudio, setPendingGreetingAudio] = useState<PendingGreetingAudio | null>(null);
  const [tailFollowRequestSignal, setTailFollowRequestSignal] = useState(0);
  const modeGridCompactProgress = useRef(new Animated.Value(0)).current;
  const rootLayoutRef = useRef<View>(null);
  const categoryGridRef = useRef<View>(null);
  const lastLoggedRenderedMessageCountRef = useRef(0);
  const greetingCycleFocusStateRef = useRef(false);
  const greetingBootstrapRecoveryCycleRef = useRef('');
  const lastInjectedGreetingCycleRef = useRef('');
  const greetingVoiceNoticeKeysRef = useRef<Set<string>>(new Set());
  const sendContextRecoveryLockRef = useRef(false);
  const sendContextRecoveryResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLoggedEmptyArtistMessageIdRef = useRef<string | null>(null);
  const autoMicTriggeredGreetingIdsRef = useRef<Set<string>>(new Set());
  const autoMicManualOverrideRef = useRef(false);
  const shouldRestoreMicAfterBlurRef = useRef(false);
  const setModeSelectScreenFocus = useCallback((nextFocused: boolean) => {
    modeSelectScreenFocusedRef.current = nextFocused;
    setIsModeSelectScreenFocused(nextFocused);
  }, []);
  const commitBoundConversationId = useCallback(
    (nextConversationId: string, reason: ModeSelectRuntimeRebindReason): boolean => {
      const normalizedNext = nextConversationId.trim();
      const normalizedCurrent = boundConversationIdRef.current.trim();
      if (normalizedCurrent === normalizedNext) {
        return false;
      }

      boundConversationIdRef.current = normalizedNext;
      modeSelectConversationIdRef.current = normalizedNext;
      setBoundConversationId(normalizedNext);
      logModeSelectDebugTrace('mode_select_rebind', {
        from: normalizedCurrent || null,
        to: normalizedNext || null,
        reason
      });
      return true;
    },
    []
  );
  const resolveModeSelectSessionHubConversation = useCallback(
    (options?: { requireEmptyConversation?: boolean }) => {
      if (!artist) {
        return null;
      }

      const requireEmptyConversation = options?.requireEmptyConversation === true;
      const liveState = useStore.getState();
      const liveConversationsForArtist = liveState.conversations[artist.id] ?? [];
      const hasMessagesForConversation = (conversationId: string): boolean => {
        const conversationMessages = liveState.messagesByConversation[conversationId]?.messages ?? [];
        return conversationMessages.length > 0;
      };
      const resolvePrimaryConversation = (conversationId: string) =>
        liveConversationsForArtist.find(
          (conversation) =>
            conversation.id === conversationId &&
            normalizeConversationThreadType(conversation.threadType) === 'primary'
        ) ?? null;

      const mappedConversationId = liveState.modeSelectSessionHubConversationByArtist[artist.id]?.trim() ?? '';
      if (mappedConversationId) {
        const mappedConversation = resolvePrimaryConversation(mappedConversationId);
        if (mappedConversation && (!requireEmptyConversation || !hasMessagesForConversation(mappedConversation.id))) {
          return mappedConversation;
        }
        setModeSelectSessionHubConversation(artist.id, '');
      }

      const recoveryAction = resolveModeSelectConversationRecoveryAction(liveConversationsForArtist);
      if (recoveryAction.type === 'use_existing') {
        const recoveredConversation = resolvePrimaryConversation(recoveryAction.conversationId);
        if (recoveredConversation && (!requireEmptyConversation || !hasMessagesForConversation(recoveredConversation.id))) {
          setModeSelectSessionHubConversation(artist.id, recoveredConversation.id);
          return recoveredConversation;
        }
      }

      const nextConversation = createConversation(
        artist.id,
        resolveGreetingConversationLanguage(artist, language),
        MODE_IDS.ON_JASE,
        { threadType: 'primary' }
      );
      setModeSelectSessionHubConversation(artist.id, nextConversation.id);
      return nextConversation;
    },
    [artist, createConversation, language, setModeSelectSessionHubConversation]
  );
  const recoverModeSelectBoundConversation = useCallback(
    (reason: 'send_recovery' | 'missing_context' | 'audio_mismatch'): string | null => {
      if (!artist) {
        return null;
      }

      const liveState = useStore.getState();
      const liveConversationsForArtist = liveState.conversations[artist.id] ?? [];
      const currentBound = boundConversationIdRef.current.trim();
      if (isValidBoundModeSelectConversation(currentBound, liveConversationsForArtist)) {
        return currentBound;
      }

      let recoveredConversationId = '';
      let recoveryActionLabel: 'mapped_hub' | 'use_existing' | 'create_new' = 'create_new';
      const mappedHubConversationId = liveState.modeSelectSessionHubConversationByArtist[artist.id]?.trim() ?? '';
      if (mappedHubConversationId && isValidBoundModeSelectConversation(mappedHubConversationId, liveConversationsForArtist)) {
        recoveredConversationId = mappedHubConversationId;
        recoveryActionLabel = 'mapped_hub';
      } else {
        const recoveryAction = resolveModeSelectConversationRecoveryAction(liveConversationsForArtist);
        if (recoveryAction.type === 'use_existing') {
          recoveredConversationId = recoveryAction.conversationId;
          recoveryActionLabel = 'use_existing';
        } else {
          const recoveryConversation = createConversation(
            artist.id,
            resolveGreetingConversationLanguage(artist, language),
            MODE_IDS.ON_JASE,
            { threadType: 'primary' }
          );
          recoveredConversationId = recoveryConversation.id;
          recoveryActionLabel = 'create_new';
          setModeSelectSessionHubConversation(artist.id, recoveryConversation.id);
        }
      }

      const normalizedRecoveredId = recoveredConversationId.trim();
      if (!normalizedRecoveredId) {
        logModeSelectDebugTrace('mode_select_recovery_failed', {
          reason,
          action: recoveryActionLabel,
          artistId: artist.id
        });
        return null;
      }

      logModeSelectDebugTrace('mode_select_recovery', {
        reason,
        action: recoveryActionLabel,
        from: currentBound || null,
        to: normalizedRecoveredId
      });
      commitBoundConversationId(normalizedRecoveredId, reason);
      if (activeConversationId !== normalizedRecoveredId) {
        setActiveConversation(normalizedRecoveredId);
      }
      return normalizedRecoveredId;
    },
    [
      activeConversationId,
      artist,
      commitBoundConversationId,
      createConversation,
      language,
      setActiveConversation,
      setModeSelectSessionHubConversation
    ]
  );
  const modeSelectInputOffset = Platform.select({ ios: 108, default: 96 }) ?? 96;
  const {
    messages,
    sendMessage,
    retryMessage,
    retryVoiceForMessage,
    hasStreaming,
    currentArtistName,
    isQuotaBlocked,
    isSendContextReady,
    audioPlayer
  } = useChat(modeSelectConversationId);
  const audioPlayerRef = useRef(audioPlayer);
  const greetingRunSequenceRef = useRef(0);
  const activeGreetingRunIdRef = useRef(0);
  useEffect(() => {
    audioPlayerRef.current = audioPlayer;
  }, [audioPlayer]);
  const stopGreetingAudio = audioPlayer.stop;
  const isValidConversation = modeSelectConversationId.length > 0;
  const isModeSelectComposerDisabled = !isValidConversation || isQuotaBlocked || !isSendContextReady;
  const replayEligibleMessages = useMemo(
    () =>
      deriveMessagesAfterReplayBarrier({
        conversationId: modeSelectConversationId,
        messages,
        barrier: replayBarrier
      }),
    [messages, modeSelectConversationId, replayBarrier]
  );

  useEffect(() => {
    modeSelectConversationIdRef.current = modeSelectConversationId;
  }, [modeSelectConversationId]);
  const sendFromModeSelectCurrentBinding = useCallback(
    (payload: ChatSendPayload, targetConversationId: string): ChatError | null => {
      const liveState = useStore.getState();
      const normalizedTargetConversationId = targetConversationId.trim();
      const liveSendContext = resolveChatSendContextFromState(liveState, normalizedTargetConversationId);
      if (!liveSendContext.conversation || !liveSendContext.artist || liveSendContext.reason !== null) {
        logModeSelectDebugTrace('send_blocked', {
          reason: liveSendContext.reason,
          liveConversationId: normalizedTargetConversationId || null,
          uiConversationId: modeSelectConversationId || null,
          artistId
        });
        return { code: 'invalidConversation' as const };
      }

      const shouldUseVoiceFiller = Boolean(
        conversationModeEnabled &&
          liveSendContext.conversation.artistId &&
          accessToken.trim() &&
          hasVoiceAccessForAccountType(effectiveAccountType)
      );

      if (shouldUseVoiceFiller && !audioPlayer.isPlaying && !audioPlayer.isLoading) {
        const fillerLanguage =
          liveSendContext.conversation.language?.trim() ? liveSendContext.conversation.language : language;
        void getRandomFillerUri(liveSendContext.conversation.artistId, fillerLanguage, accessToken)
          .then((uri) => {
            if (!uri) {
              return;
            }
            if (!modeSelectScreenFocusedRef.current) {
              return;
            }
            if (!audioPlayer.isPlaying && !audioPlayer.isLoading) {
              void attemptVoiceAutoplayUri({
                audioPlayer,
                uri
              });
            }
          })
          .catch(() => {
            // Non-blocking latency helper.
          });
      }

      setTailFollowRequestSignal((previous) => previous + 1);
      logModeSelectDebugTrace('send_dispatched', {
        conversationId: normalizedTargetConversationId,
        uiConversationId: modeSelectConversationId || null,
        boundConversationId: boundConversationIdRef.current.trim() || null,
        hasImage: Boolean(payload.image),
        textLength: payload.text.length
      });
      const sendError = sendMessage(payload, {
        conversationId: normalizedTargetConversationId
      });
      logModeSelectDebugTrace('send_result', {
        conversationId: normalizedTargetConversationId,
        code: sendError?.code ?? null
      });
      return sendError;
    },
    [
      accessToken,
      artistId,
      audioPlayer,
      conversationModeEnabled,
      effectiveAccountType,
      language,
      modeSelectConversationId,
      sendMessage
    ]
  );
  const resolveModeSelectSendTargetConversationId = useCallback((): string | null => {
    if (!artist?.id) {
      return null;
    }

    const liveState = useStore.getState();
    const uiConversationId = modeSelectConversationId.trim();
    const boundRefConversationId = boundConversationIdRef.current.trim();
    const isValidTarget = (candidateConversationId: string): boolean => {
      if (!candidateConversationId) {
        return false;
      }
      const sendContext = resolveChatSendContextFromState(liveState, candidateConversationId);
      if (!sendContext.conversation || !sendContext.artist || sendContext.reason !== null) {
        return false;
      }
      if (sendContext.conversation.artistId !== artist.id) {
        return false;
      }
      return normalizeConversationThreadType(sendContext.conversation.threadType) === 'primary';
    };

    if (isValidTarget(uiConversationId)) {
      return uiConversationId;
    }
    if (isValidTarget(boundRefConversationId)) {
      return boundRefConversationId;
    }

    return recoverModeSelectBoundConversation('send_recovery');
  }, [artist?.id, modeSelectConversationId, recoverModeSelectBoundConversation]);
  const sendFromModeSelect = useCallback(
    (payload: ChatSendPayload): ChatError | null => {
      const normalizedText = payload.text.trim();
      if (normalizedText && !payload.image && artist?.id) {
        const launchOutcome = tryLaunchExperienceFromText({
          artistId: artist.id,
          text: normalizedText,
          fallbackLanguage: language,
          preferredConversationLanguage: modeSelectConversationLanguage
        });
        if (launchOutcome.launched) {
          return null;
        }
      }

      const targetConversationId = resolveModeSelectSendTargetConversationId();
      if (!targetConversationId) {
        logModeSelectDebugTrace('send_blocked', {
          reason: 'missing_target_conversation',
          uiConversationId: modeSelectConversationId || null,
          boundConversationId: boundConversationIdRef.current.trim() || null
        });
        return { code: 'invalidConversation' as const };
      }

      if (targetConversationId !== modeSelectConversationId) {
        logModeSelectDebugTrace('send_target_rebind', {
          from: modeSelectConversationId || null,
          to: targetConversationId,
          hasImage: Boolean(payload.image),
          textLength: payload.text.length
        });
        commitBoundConversationId(targetConversationId, 'send_recovery');
        if (activeConversationId !== targetConversationId) {
          setActiveConversation(targetConversationId);
        }
      }

      let sendError = sendFromModeSelectCurrentBinding(payload, targetConversationId);
      if (sendError?.code === 'invalidConversation') {
        const recoveredConversationId = recoverModeSelectBoundConversation('send_recovery');
        if (!recoveredConversationId) {
          return sendError;
        }
        if (recoveredConversationId !== modeSelectConversationId) {
          commitBoundConversationId(recoveredConversationId, 'send_recovery');
          if (activeConversationId !== recoveredConversationId) {
            setActiveConversation(recoveredConversationId);
          }
        }
        sendError = sendFromModeSelectCurrentBinding(payload, recoveredConversationId);
      }

      return sendError;
    },
    [
      activeConversationId,
      artist?.id,
      commitBoundConversationId,
      language,
      modeSelectConversationId,
      modeSelectConversationLanguage,
      recoverModeSelectBoundConversation,
      resolveModeSelectSendTargetConversationId,
      sendFromModeSelectCurrentBinding,
      setActiveConversation
    ]
  );
  const {
    isListening,
    transcript,
    error: conversationError,
    status: conversationStatus,
    hint: conversationHint,
    pauseListening,
    resumeListening,
    armListeningActivation
  } = useVoiceConversation({
    enabled: isValidConversation && isSendContextReady && conversationModeEnabled && !isQuotaBlocked,
    disabled: isModeSelectComposerDisabled,
    hasTypedDraft,
    isPlaying: audioPlayer.isPlaying || audioPlayer.isLoading || hasStreaming,
    isAudioPlaybackLoading: audioPlayer.isLoading,
    onSend: (text) => {
      const normalized = text.trim();
      if (!normalized) {
        return;
      }
      sendFromModeSelect({ text: normalized });
    },
    onStopAudio: () => {
      audioPlayer.gracefulStop();
    },
    language: modeSelectConversationLanguage,
    fallbackLanguage: language
  });
  const resolvedArtistDisplayName = formatArtistDisplayName(currentArtistName ?? artistDisplayName);
  const isGreetingVoicePendingGesture = Boolean(pendingGreetingAudio);
  const hasVisibleConversationText = messages.some(
    (message) => message.status === 'complete' && message.content.trim().length > 0
  );
  const isEnglishLanguage = language.toLowerCase().startsWith('en');
  const showGreetingBootingIndicator = isValidConversation && messages.length === 0 && isGreetingBooting;
  const greetingBootingLabel = isEnglishLanguage
    ? 'Loading...'
    : GREETING_BOOTING_FR_LINES[greetingBootingLineIndex % GREETING_BOOTING_FR_LINES.length];
  const shouldCompactModeGrid =
    isValidConversation &&
    (hasVisibleConversationText ||
      hasStreaming ||
      ((Platform.OS === 'ios' || Platform.OS === 'android') && isInputFocused));
  const isGreetingVoiceActive =
    greeting !== null &&
    (audioPlayer.isLoading || audioPlayer.isPlaying || isGreetingVoicePendingGesture);
  const greetingVoiceLabel = isEnglishLanguage
    ? isGreetingVoicePendingGesture
      ? 'Tap anywhere to enable Cathy audio.'
      : 'Cathy is speaking...'
    : isGreetingVoicePendingGesture
      ? "Touchez l'écran pour activer la voix de Cathy."
      : 'Cathy parle...';
  const isNativeMobile = Platform.OS === 'ios' || Platform.OS === 'android';
  const fallbackOverlayTop = Math.floor(
    viewportHeight * (
      shouldCompactModeGrid
        ? isNativeMobile
          ? 0.3
          : 0.32
        : Platform.OS === 'ios'
          ? 0.58
          : 0.54
    )
  );
  const measuredOverlayTop =
    typeof categoryGridBottomY === 'number' ? Math.ceil(categoryGridBottomY + theme.spacing.sm) : fallbackOverlayTop;
  const compactOverlayMinTop = Math.max(
    theme.spacing.xl * 2,
    Math.floor(viewportHeight * (isNativeMobile ? 0.18 : 0.2))
  );
  const expandedOverlayMinTop = Math.floor(viewportHeight * 0.46);
  const minOverlayTop = shouldCompactModeGrid ? compactOverlayMinTop : expandedOverlayMinTop;
  const maxOverlayTop = Math.floor(viewportHeight * 0.75);
  const conversationOverlayTop = Math.min(Math.max(measuredOverlayTop, minOverlayTop), maxOverlayTop);
  const chatWindowMaxHeight = Math.max(
    160,
    Math.floor(viewportHeight - modeSelectInputOffset - conversationOverlayTop - theme.spacing.xs)
  );
  const modeSelectScreenPaddingBottom = shouldCompactModeGrid
    ? theme.spacing.xl
    : chatWindowMaxHeight + modeSelectInputOffset + theme.spacing.xl;

  const measureCategoryGridBottom = useCallback(() => {
    const rootNode = rootLayoutRef.current;
    const gridNode = categoryGridRef.current;
    if (!rootNode || !gridNode) {
      return;
    }

    rootNode.measureInWindow((_rootX, rootY) => {
      gridNode.measureInWindow((_gridX, gridY, _gridWidth, gridHeight) => {
        if (!Number.isFinite(gridHeight) || gridHeight <= 0) {
          return;
        }

        const relativeBottom = Math.max(0, gridY - rootY + gridHeight);
        setCategoryGridBottomY((previous) => {
          if (typeof previous === 'number' && Math.abs(previous - relativeBottom) < 1) {
            return previous;
          }
          return relativeBottom;
        });
      });
    });
  }, []);

  const clearSendContextRecoveryLock = useCallback(() => {
    if (sendContextRecoveryResetTimeoutRef.current) {
      clearTimeout(sendContextRecoveryResetTimeoutRef.current);
      sendContextRecoveryResetTimeoutRef.current = null;
    }
    sendContextRecoveryLockRef.current = false;
  }, []);

  const finalizeGreetingRun = useCallback(
    (params: {
      runId: number;
      cycleKey: string;
      hasInsertedGreetingMessage: boolean;
      allowCycleReopen: boolean;
      reason: string;
    }) => {
      const { runId, cycleKey, hasInsertedGreetingMessage, allowCycleReopen, reason } = params;

      if (activeGreetingRunIdRef.current === runId) {
        activeGreetingRunIdRef.current = 0;
        setIsGreetingBooting(false);
      }

      if (
        allowCycleReopen &&
        !hasInsertedGreetingMessage &&
        lastInjectedGreetingCycleRef.current === cycleKey
      ) {
        lastInjectedGreetingCycleRef.current = '';
        logModeSelectDebugTrace('greeting_cycle_reopened', {
          cycleKey,
          reason
        });
      }
    },
    []
  );

  const enqueueGreetingVoiceNotice = useCallback(
    (params: {
      conversationId: string;
      greetingMessageId: string;
      errorCode: string;
    }) => {
      const normalizedConversationId = params.conversationId.trim();
      const normalizedMessageId = params.greetingMessageId.trim();
      const normalizedCode = params.errorCode.trim() || 'TTS_PROVIDER_ERROR';
      if (!normalizedConversationId || !normalizedMessageId) {
        return;
      }

      const noticeKey = `${normalizedMessageId}:${normalizedCode}`;
      if (greetingVoiceNoticeKeysRef.current.has(noticeKey)) {
        return;
      }
      greetingVoiceNoticeKeysRef.current.add(noticeKey);

      const terminalCode = isGreetingTerminalTtsCode(normalizedCode) ? normalizedCode : null;
      const latestSessionUser = useStore.getState().session?.user;
      const latestAccountType = resolveEffectiveAccountType(
        latestSessionUser?.accountType ?? null,
        latestSessionUser?.role ?? null
      );
      const noticeMetadata: NonNullable<Message['metadata']> = {
        injected: true,
        errorCode: normalizedCode
      };
      if (terminalCode && shouldShowUpgradeForTtsCode(terminalCode) && latestAccountType !== 'admin') {
        noticeMetadata.showUpgradeCta = true;
        noticeMetadata.upgradeFromTier = latestAccountType;
      }

      addMessage(normalizedConversationId, {
        id: generateId('msg'),
        conversationId: normalizedConversationId,
        role: 'artist',
        content: buildCathyVoiceUnavailableNotice(resolveGreetingVoiceNoticeCode(normalizedCode)),
        status: 'complete',
        timestamp: new Date().toISOString(),
        metadata: noticeMetadata
      });
    },
    [addMessage]
  );

  const stopModeSelectGreetingPlayback = useCallback(() => {
    setPendingGreetingAudio(null);
    setPendingAutoMicGreetingMessageId(null);
    autoMicManualOverrideRef.current = false;
    void stopGreetingAudio();
  }, [stopGreetingAudio]);

  const stopModeSelectVoiceAndMic = useCallback(() => {
    stopModeSelectGreetingPlayback();
    pauseListening();
  }, [pauseListening, stopModeSelectGreetingPlayback]);

  const captureReplayBarrierOnBlur = useCallback(() => {
    const liveConversationId = modeSelectConversationIdRef.current.trim();
    if (!liveConversationId) {
      setReplayBarrier(null);
      return;
    }

    const liveMessages = useStore.getState().messagesByConversation[liveConversationId]?.messages ?? [];
    const shouldExcludePlayingMessage = audioPlayer.isPlaying || audioPlayer.isLoading;
    const playingMessageId =
      shouldExcludePlayingMessage && audioPlayer.currentMessageId
        ? audioPlayer.currentMessageId.trim()
        : '';

    setReplayBarrier(
      captureModeSelectReplayBarrier(liveConversationId, liveMessages, {
        excludeMessageId: playingMessageId || null
      })
    );
  }, [audioPlayer.currentMessageId, audioPlayer.isLoading, audioPlayer.isPlaying]);

  useEffect(() => {
    const currentMessageId = audioPlayer.currentMessageId?.trim() ?? '';
    if (!artist?.id || !currentMessageId || (!audioPlayer.isPlaying && !audioPlayer.isLoading)) {
      return;
    }

    const liveState = useStore.getState();
    const liveConversationsForArtist = liveState.conversations[artist.id] ?? [];
    const playbackConversationId = findArtistConversationIdForMessageId({
      conversationsForArtist: liveConversationsForArtist,
      messagesByConversation: liveState.messagesByConversation,
      messageId: currentMessageId
    });
    if (!playbackConversationId || playbackConversationId === boundConversationIdRef.current.trim()) {
      return;
    }

    if (hasStreaming) {
      logModeSelectDebugTrace('audio_mismatch_skipped_streaming', {
        from: boundConversationIdRef.current.trim() || null,
        to: playbackConversationId,
        messageId: currentMessageId
      });
      return;
    }

    logModeSelectDebugTrace('audio_mismatch_rebind', {
      from: boundConversationIdRef.current.trim() || null,
      to: playbackConversationId,
      messageId: currentMessageId
    });
    commitBoundConversationId(playbackConversationId, 'audio_mismatch');
    if (activeConversationId !== playbackConversationId) {
      setActiveConversation(playbackConversationId);
    }
  }, [
    activeConversationId,
    artist?.id,
    audioPlayer.currentMessageId,
    audioPlayer.isLoading,
    audioPlayer.isPlaying,
    commitBoundConversationId,
    hasStreaming,
    setActiveConversation
  ]);

  useEffect(() => {
    if (
      !conversationModeEnabled ||
      !artist?.id ||
      !accessToken.trim() ||
      !hasVoiceAccessForAccountType(effectiveAccountType)
    ) {
      return;
    }

    prewarmVoiceFillers(artist.id, modeSelectConversationLanguage, accessToken);
  }, [accessToken, artist?.id, conversationModeEnabled, effectiveAccountType, modeSelectConversationLanguage]);

  useEffect(() => {
    if (lastBoundArtistIdRef.current === artistId) {
      return;
    }

    lastBoundArtistIdRef.current = artistId;
    commitBoundConversationId('', 'artist_changed');
  }, [artistId, commitBoundConversationId]);

  useEffect(() => {
    if (resolvedBoundConversation.reason === 'keep_bound') {
      return;
    }

    const currentBound = boundConversationIdRef.current.trim();
    const nextBound = resolvedBoundConversation.conversationId.trim();
    if (!nextBound && resolvedBoundConversation.reason === 'missing_context' && currentBound && hasStreaming) {
      logModeSelectDebugTrace('mode_select_rebind_skipped_streaming', {
        from: currentBound,
        reason: resolvedBoundConversation.reason
      });
      return;
    }

    commitBoundConversationId(nextBound, resolvedBoundConversation.reason);
  }, [commitBoundConversationId, hasStreaming, resolvedBoundConversation.conversationId, resolvedBoundConversation.reason]);

  useEffect(() => {
    if (!modeSelectConversationId || activeConversationId === modeSelectConversationId) {
      return;
    }
    setActiveConversation(modeSelectConversationId);
  }, [activeConversationId, modeSelectConversationId, setActiveConversation]);

  useEffect(() => {
    if (isSendContextReady) {
      clearSendContextRecoveryLock();
      return;
    }

    if (!isValidConversation || isQuotaBlocked || sendContextRecoveryLockRef.current) {
      return;
    }

    if (!artist || !isGreetingGateSatisfied) {
      return;
    }

    sendContextRecoveryLockRef.current = true;
    const recoveredConversationId = recoverModeSelectBoundConversation('missing_context');
    if (!recoveredConversationId) {
      sendContextRecoveryLockRef.current = false;
      return;
    }

    sendContextRecoveryResetTimeoutRef.current = setTimeout(() => {
      sendContextRecoveryLockRef.current = false;
      sendContextRecoveryResetTimeoutRef.current = null;
    }, 350);
  }, [
    artist,
    clearSendContextRecoveryLock,
    isGreetingGateSatisfied,
    isQuotaBlocked,
    isSendContextReady,
    isValidConversation,
    recoverModeSelectBoundConversation
  ]);

  useEffect(() => {
    if (!isModeSelectDebugLoggingEnabled()) {
      return;
    }

    const nextCount = messages.length;
    if (nextCount === lastLoggedRenderedMessageCountRef.current) {
      return;
    }
    lastLoggedRenderedMessageCountRef.current = nextCount;

    const latestMessage = nextCount > 0 ? messages[nextCount - 1] : null;
    logModeSelectDebugTrace('messages_rendered', {
      conversationId: modeSelectConversationId || null,
      messageCount: nextCount,
      latestMessageId: latestMessage?.id ?? null,
      latestRole: latestMessage?.role ?? null,
      latestStatus: latestMessage?.status ?? null,
      latestContentLength: latestMessage?.content.length ?? 0
    });
  }, [messages, modeSelectConversationId]);

  useAutoReplayLastArtistMessage({
    messages: replayEligibleMessages,
    audioPlayer,
    enabled: isValidConversation && isModeSelectScreenFocused,
    hasStreaming,
    voiceAutoPlay: voiceAutoPlay || conversationModeEnabled,
    replayOnFocus: false
  });

  useEffect(() => {
    if (!isModeSelectDebugLoggingEnabled()) {
      return;
    }

    const latestCompleteArtistMessage = messages
      .slice()
      .reverse()
      .find((message) => message.role === 'artist' && message.status === 'complete');
    if (!latestCompleteArtistMessage) {
      return;
    }

    const normalizedVisibleText = stripAudioTags(latestCompleteArtistMessage.content, { trim: true });
    if (normalizedVisibleText.length > 0) {
      return;
    }

    if (lastLoggedEmptyArtistMessageIdRef.current === latestCompleteArtistMessage.id) {
      return;
    }
    lastLoggedEmptyArtistMessageIdRef.current = latestCompleteArtistMessage.id;

    logModeSelectDebugTrace('artist_complete_empty', {
      conversationId: modeSelectConversationId || null,
      messageId: latestCompleteArtistMessage.id,
      rawLength: latestCompleteArtistMessage.content.length,
      voiceStatus: latestCompleteArtistMessage.metadata?.voiceStatus ?? null,
      voiceQueueLength: Array.isArray(latestCompleteArtistMessage.metadata?.voiceQueue)
        ? latestCompleteArtistMessage.metadata.voiceQueue.length
        : 0
    });
  }, [messages, modeSelectConversationId]);

  useEffect(() => {
    setIsInputFocused(false);
    setIsGreetingBooting(false);
    setPendingAutoMicGreetingMessageId(null);
    setReplayBarrier(null);
    setTailFollowRequestSignal(0);
    setGreetingOpenCycle(0);
    shouldRestoreMicAfterBlurRef.current = false;
    autoMicManualOverrideRef.current = false;
    autoMicTriggeredGreetingIdsRef.current.clear();
    greetingCycleFocusStateRef.current = false;
    greetingBootstrapRecoveryCycleRef.current = '';
    lastInjectedGreetingCycleRef.current = '';
  }, [artistId]);

  useEffect(() => {
    const wasFocused = greetingCycleFocusStateRef.current;
    if (isModeSelectScreenFocused && !wasFocused) {
      setGreetingOpenCycle((previous) => previous + 1);
    }
    greetingCycleFocusStateRef.current = isModeSelectScreenFocused;
  }, [artistId, isModeSelectScreenFocused]);

  useEffect(() => {
    const targetMessageId = pendingAutoMicGreetingMessageId;
    const targetMessage =
      targetMessageId
        ? messages.find(
            (message) => message.id === targetMessageId && message.role === 'artist' && message.status === 'complete'
          ) ?? null
        : null;

    const decision = resolveGreetingAutoMicDecision({
      hasPendingGreetingMessageId: Boolean(targetMessageId),
      hasAlreadyTriggered: Boolean(targetMessageId && autoMicTriggeredGreetingIdsRef.current.has(targetMessageId)),
      hasManualOverride: autoMicManualOverrideRef.current,
      injectedType: targetMessage?.metadata?.injectedType,
      isModeSelectScreenFocused,
      isValidConversation,
      isQuotaBlocked,
      hasTypedDraft,
      hasStreaming,
      isGreetingVoiceActive,
      isGreetingBooting,
      conversationModeEnabled
    });

    if (decision === 'skip') {
      return;
    }

    if (decision === 'arm_listening') {
      armListeningActivation();
    } else if (decision === 'force_enable_and_resume') {
      setConversationModeEnabled(true);
      resumeListening();
    }

    if (targetMessageId) {
      autoMicTriggeredGreetingIdsRef.current.add(targetMessageId);
    }
    setPendingAutoMicGreetingMessageId(null);
  }, [
    armListeningActivation,
    conversationModeEnabled,
    isGreetingBooting,
    isGreetingVoiceActive,
    isModeSelectScreenFocused,
    hasStreaming,
    hasTypedDraft,
    isQuotaBlocked,
    isValidConversation,
    messages,
    pendingAutoMicGreetingMessageId,
    resumeListening,
    setConversationModeEnabled
  ]);

  const handlePauseListening = useCallback(() => {
    setConversationModeEnabled(false);
    const pendingMessageId = pendingAutoMicGreetingMessageId;
    if (pendingMessageId && !autoMicTriggeredGreetingIdsRef.current.has(pendingMessageId)) {
      autoMicManualOverrideRef.current = true;
      autoMicTriggeredGreetingIdsRef.current.add(pendingMessageId);
      setPendingAutoMicGreetingMessageId(null);
    }
    pauseListening();
  }, [pauseListening, pendingAutoMicGreetingMessageId, setConversationModeEnabled]);

  useEffect(() => {
    if (!showGreetingBootingIndicator || isEnglishLanguage) {
      return;
    }

    setGreetingBootingLineIndex(Math.floor(Math.random() * GREETING_BOOTING_FR_LINES.length));
    const intervalId = setInterval(() => {
      setGreetingBootingLineIndex((previous) => (previous + 1) % GREETING_BOOTING_FR_LINES.length);
    }, GREETING_BOOTING_ROTATION_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [isEnglishLanguage, showGreetingBootingIndicator]);

  useEffect(() => {
    const unsubscribeFocus = navigation.addListener('focus', () => {
      setModeSelectScreenFocus(true);
    });
    const unsubscribeBlur = navigation.addListener('blur', () => {
      shouldRestoreMicAfterBlurRef.current = shouldRestoreModeSelectMicAfterBlur(
        conversationModeEnabled,
        conversationStatus
      );
      setModeSelectScreenFocus(false);
      captureReplayBarrierOnBlur();
      stopModeSelectVoiceAndMic();
    });

    return () => {
      unsubscribeFocus();
      unsubscribeBlur();
    };
  }, [
    captureReplayBarrierOnBlur,
    conversationModeEnabled,
    conversationStatus,
    navigation,
    setModeSelectScreenFocus,
    stopModeSelectVoiceAndMic
  ]);

  useEffect(() => {
    if (!isModeSelectScreenFocused || !shouldRestoreMicAfterBlurRef.current) {
      return;
    }

    if (!conversationModeEnabled) {
      shouldRestoreMicAfterBlurRef.current = false;
      return;
    }

    if (isModeSelectComposerDisabled) {
      return;
    }

    shouldRestoreMicAfterBlurRef.current = false;
    resumeListening();
  }, [conversationModeEnabled, isModeSelectComposerDisabled, isModeSelectScreenFocused, resumeListening]);

  useEffect(() => {
    Animated.timing(modeGridCompactProgress, {
      toValue: shouldCompactModeGrid ? 1 : 0,
      duration: 240,
      useNativeDriver: false
    }).start();
  }, [modeGridCompactProgress, shouldCompactModeGrid]);

  useEffect(() => {
    const timer = setTimeout(() => {
      measureCategoryGridBottom();
    }, 280);

    return () => {
      clearTimeout(timer);
    };
  }, [measureCategoryGridBottom, shouldCompactModeGrid, viewportHeight, messages.length]);

  useEffect(() => {
    if (E2E_AUTH_BYPASS || !artist) {
      return;
    }

    if (
      !shouldRecoverGreetingBootstrapConversation({
        artistId: artist.id,
        greetingOpenCycle,
        isModeSelectScreenFocused,
        isGreetingGateSatisfied,
        modeSelectConversationId
      })
    ) {
      return;
    }

    const cycleKey = `${artist.id}:${greetingOpenCycle}`;
    if (greetingBootstrapRecoveryCycleRef.current === cycleKey) {
      return;
    }
    greetingBootstrapRecoveryCycleRef.current = cycleKey;

    const introConversation = resolveModeSelectSessionHubConversation({
      requireEmptyConversation: true
    });
    if (!introConversation) {
      logModeSelectDebugTrace('greeting_bootstrap_recovery_failed', {
        artistId: artist.id,
        cycle: greetingOpenCycle
      });
      return;
    }

    commitBoundConversationId(introConversation.id, 'missing_context');
    const liveActiveConversationId = useStore.getState().activeConversationId;
    if (liveActiveConversationId !== introConversation.id) {
      setActiveConversation(introConversation.id);
    }

    logModeSelectDebugTrace('greeting_bootstrap_recovered', {
      artistId: artist.id,
      cycle: greetingOpenCycle,
      conversationId: introConversation.id
    });
  }, [
    artist,
    commitBoundConversationId,
    greetingOpenCycle,
    isGreetingGateSatisfied,
    isModeSelectScreenFocused,
    modeSelectConversationId,
    resolveModeSelectSessionHubConversation,
    setActiveConversation
  ]);

  useEffect(() => {
    if (!E2E_AUTH_BYPASS || !artist || !isModeSelectScreenFocused || greetingOpenCycle <= 0) {
      return;
    }

    const cycleKey = `${artist.id}:bypass:${greetingOpenCycle}`;
    if (lastInjectedGreetingCycleRef.current === cycleKey) {
      return;
    }
    lastInjectedGreetingCycleRef.current = cycleKey;

    const conversation = resolveModeSelectSessionHubConversation();
    if (!conversation) {
      return;
    }
    commitBoundConversationId(conversation.id, 'missing_context');
    const liveActiveConversationId = useStore.getState().activeConversationId;
    if (liveActiveConversationId !== conversation.id) {
      setActiveConversation(conversation.id);
    }
    setIsGreetingBooting(false);
  }, [
    artist,
    commitBoundConversationId,
    greetingOpenCycle,
    isModeSelectScreenFocused,
    resolveModeSelectSessionHubConversation,
    setActiveConversation
  ]);

  useEffect(() => {
    if (E2E_AUTH_BYPASS) {
      logModeSelectDebugTrace('greeting_skipped_bypass', {
        artistId: artist?.id ?? null
      });
      return;
    }

    if (!artist || !isModeSelectScreenFocused || greetingOpenCycle <= 0) {
      return;
    }
    // Read live from store instead of using the reactive selector: markArtistGreeted() is called
    // inside this run, which would change hasArtistBeenGreetedThisSession mid-flight and trigger
    // a cleanup/re-run cycle that cancels TTS before audio can play.
    if (useStore.getState().greetedArtistIds.has(artist.id)) {
      return;
    }

    const cycleKey = `${artist.id}:${greetingOpenCycle}`;
    if (lastInjectedGreetingCycleRef.current === cycleKey) {
      return;
    }
    lastInjectedGreetingCycleRef.current = cycleKey;

    const runId = greetingRunSequenceRef.current + 1;
    greetingRunSequenceRef.current = runId;
    activeGreetingRunIdRef.current = runId;

    let isCancelled = false;
    let hasInsertedGreetingMessage = false;
    let introConversationId = '';
    const isRunActive = (): boolean => !isCancelled && activeGreetingRunIdRef.current === runId;

    const runGreeting = async () => {
      const sessionStateBeforeGreeting = useStore.getState();
      setIsGreetingBooting(true);
      logModeSelectDebugTrace('greeting_run_started', {
        artistId: artist.id,
        cycle: greetingOpenCycle,
        runId
      });

      try {
        const greetedArtistCount = sessionStateBeforeGreeting.greetedArtistIds.size;
        const isSessionFirstGreeting = greetedArtistCount === 0;
        const introConversation = resolveModeSelectSessionHubConversation({
          requireEmptyConversation: true
        });
        if (!introConversation) {
          logModeSelectDebugTrace('greeting_run_missing_intro_conversation', {
            artistId: artist.id,
            cycle: greetingOpenCycle,
            runId
          });
          return;
        }
        introConversationId = introConversation.id;
        commitBoundConversationId(introConversation.id, 'missing_context');
        const liveActiveConversationId = useStore.getState().activeConversationId;
        if (liveActiveConversationId !== introConversation.id) {
          setActiveConversation(introConversation.id);
        }
        const shouldSkipBeforeApi = shouldSkipModeSelectGreetingInjection(
          sessionStateBeforeGreeting.messagesByConversation[introConversation.id]?.messages ?? []
        );
        if (shouldSkipBeforeApi) {
          logModeSelectDebugTrace('greeting_skipped_tail_dedupe_pre_api', {
            artistId: artist.id,
            conversationId: introConversation.id,
            cycle: greetingOpenCycle
          });
          return;
        }

        const availableModes = buildAvailableModesForGreeting(artist, language);
        const coords = await getOptionalCoords();
        if (!isRunActive()) {
          return;
        }

        const greetingMemoryFacts = collectArtistMemoryFacts(sessionStateBeforeGreeting, artist.id, introConversation.id);
        const greetingActivityContext = deriveGreetingActivityContext(sessionStateBeforeGreeting, artist.id, language);
        const fetchedResult = await fetchModeSelectGreetingFromApi(
          {
            artistId: artist.id,
            language,
            accessToken,
            coords,
            availableModes,
            preferredName,
            isSessionFirstGreeting,
            memoryFacts: greetingMemoryFacts,
            recentActivityFacts: greetingActivityContext.recentActivityFacts,
            askActivityFeedback: greetingActivityContext.askActivityFeedback,
            lastGreetingSnippet: greetingActivityContext.lastGreetingSnippet,
            recentExperienceName: greetingActivityContext.recentExperienceName,
            recentExperienceType: greetingActivityContext.recentExperienceType,
            activityFeedbackCue: greetingActivityContext.activityFeedbackCue
          },
          {
            onTrace: (event, payload) => {
              logModeSelectDebugTrace(`greeting_api_${event}`, {
                artistId: artist.id,
                cycle: greetingOpenCycle,
                ...(payload ?? {})
              });
            }
          }
        );
        if (!isRunActive()) {
          return;
        }
        if (fetchedResult.timedOut) {
          logModeSelectDebugTrace('greeting_api_timeout_fallback', {
            artistId: artist.id,
            cycle: greetingOpenCycle
          });
        }
        const tutorialAlreadyCompleted = Boolean(sessionStateBeforeGreeting.completedTutorials.greeting);
        const fallbackTutorialMode = isSessionFirstGreeting && !tutorialAlreadyCompleted;
        const isTutorialConversationForMetadata =
          !tutorialAlreadyCompleted && (fetchedResult.tutorial?.active ?? fallbackTutorialMode);
        const forceGreetingAutoplay = isTutorialConversationForMetadata;
        const isTutorialGreetingCopy = isTutorialConversationForMetadata || GREETING_FORCE_TUTORIAL;
        const greetingMetadata = {
          injected: true,
          tutorialMode: isTutorialConversationForMetadata,
          injectedType: isTutorialConversationForMetadata ? 'tutorial_greeting' : 'greeting',
          greetingActivitySnapshot: greetingActivityContext.currentSnapshot
        } as const;
        const nextGreeting =
          fetchedResult.greeting ??
          buildFallbackGreetingText(artist, language, preferredName, availableModes, isTutorialGreetingCopy, {
            recentActivityFacts: greetingActivityContext.recentActivityFacts,
            askActivityFeedback: greetingActivityContext.askActivityFeedback,
            lastGreetingSnippet: greetingActivityContext.lastGreetingSnippet,
            recentExperienceName: greetingActivityContext.recentExperienceName,
            recentExperienceType: greetingActivityContext.recentExperienceType,
            activityFeedbackCue: greetingActivityContext.activityFeedbackCue
          });
        if (!isRunActive() || !nextGreeting) {
          return;
        }
        const shouldSkipBeforeInsert = shouldSkipModeSelectGreetingInjection(
          useStore.getState().messagesByConversation[introConversation.id]?.messages ?? []
        );
        if (shouldSkipBeforeInsert) {
          logModeSelectDebugTrace('greeting_skipped_tail_dedupe_pre_insert', {
            artistId: artist.id,
            conversationId: introConversation.id,
            cycle: greetingOpenCycle
          });
          return;
        }

        const now = new Date().toISOString();
        const greetingMessageId = generateId('msg');
        // Insert a placeholder (typing indicator) while TTS pre-synthesizes.
        // The real text is revealed only when audio is ready to play, so text
        // and voice start at the same moment instead of text appearing 1-2s early.
        addMessage(introConversation.id, {
          id: greetingMessageId,
          conversationId: introConversation.id,
          role: 'artist',
          content: '',
          status: 'streaming',
          timestamp: now,
          metadata: greetingMetadata
        });
        markArtistGreeted(artist.id);
        autoMicManualOverrideRef.current = false;
        setPendingAutoMicGreetingMessageId(greetingMessageId);
        setReplayBarrier({
          conversationId: introConversation.id,
          messageId: greetingMessageId
        });
        hasInsertedGreetingMessage = true;
        updateConversation(
          introConversation.id,
          {
            lastMessagePreview: nextGreeting.slice(0, 120),
            title: nextGreeting.slice(0, 30)
          },
          artist.id
        );

        setGreeting(nextGreeting);
        setPendingGreetingAudio(null);

        if (!accessToken.trim()) {
          const unresolvedErrorCode = 'UNAUTHORIZED';
          // Replace placeholder with full text (no voice).
          updateMessage(introConversation.id, greetingMessageId, {
            content: nextGreeting,
            status: 'complete',
            metadata: {
              ...greetingMetadata,
              voiceStatus: 'unavailable',
              voiceErrorCode: unresolvedErrorCode,
              voiceUrl: undefined,
              voiceQueue: undefined,
              voiceChunkBoundaries: undefined
            }
          });
          enqueueGreetingVoiceNotice({
            conversationId: introConversation.id,
            greetingMessageId,
            errorCode: unresolvedErrorCode
          });
          return;
        }

        try {
          // Clear any leftover cooldown from a previous session so a prior rate-limit
          // error doesn't silently block the greeting on a fresh open.
          clearTerminalCooldownForPurpose(artist.id, language, 'greeting', accessToken);
          const greetingAudioUri = await synthesizeVoice(nextGreeting, artist.id, language, accessToken, {
            purpose: 'greeting'
          });

          // Always resolve the placeholder with full text and voice metadata, even if we
          // are about to return early. If we skip this, the typing indicator stays stuck forever.
          updateMessage(introConversation.id, greetingMessageId, {
            content: nextGreeting,
            status: 'complete',
            metadata: {
              ...greetingMetadata,
              voiceUrl: greetingAudioUri,
              voiceQueue: [greetingAudioUri],
              voiceStatus: 'ready',
              voiceChunkBoundaries: [nextGreeting.length]
            }
          });

          if (!isRunActive()) {
            return;
          }
          if (!modeSelectScreenFocusedRef.current) {
            return;
          }

          const shouldAutoPlayGreeting = shouldAutoPlayGreetingVoice({
            conversationModeEnabled,
            voiceAutoPlayEnabled: voiceAutoPlay,
            forceAutoplay: forceGreetingAutoplay,
            quotaBlocked: isQuotaBlocked
          });
          if (!shouldAutoPlayGreeting) {
            return;
          }

          const playbackOutcome = await attemptGreetingAutoplayWithRetries({
            audioPlayer: audioPlayerRef.current,
            uri: greetingAudioUri,
            messageId: greetingMessageId
          });
          if (playbackOutcome.state === 'pending_web_unlock') {
            setPendingGreetingAudio({
              conversationId: introConversation.id,
              uri: greetingAudioUri,
              messageId: greetingMessageId,
              forceAutoplay: forceGreetingAutoplay
            });
            return;
          }
          if (playbackOutcome.state === 'failed') {
            logModeSelectDebugTrace('greeting_autoplay_failed_non_fatal', {
              conversationId: introConversation.id,
              messageId: greetingMessageId,
              failureReason: playbackOutcome.failureReason
            });
            // Queue for retry when the screen re-focuses or the user interacts.
            setPendingGreetingAudio({
              conversationId: introConversation.id,
              uri: greetingAudioUri,
              messageId: greetingMessageId,
              forceAutoplay: forceGreetingAutoplay
            });
          }
        } catch (error) {
          // TTS failed — always replace placeholder with full text so the typing indicator
          // doesn't get stuck, even if the run was already cancelled.
          const resolvedVoiceErrorCode = resolveVoiceErrorCode(error);
          const greetingVoiceErrorCode = resolvedVoiceErrorCode === 'UNKNOWN' ? 'TTS_PROVIDER_ERROR' : resolvedVoiceErrorCode;
          updateMessage(introConversation.id, greetingMessageId, {
            content: nextGreeting,
            status: 'complete',
            metadata: {
              ...greetingMetadata,
              voiceStatus: 'unavailable',
              voiceErrorCode: greetingVoiceErrorCode,
              voiceUrl: undefined,
              voiceQueue: undefined,
              voiceChunkBoundaries: undefined
            }
          });

          enqueueGreetingVoiceNotice({
            conversationId: introConversation.id,
            greetingMessageId,
            errorCode: greetingVoiceErrorCode
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logModeSelectDebugTrace('greeting_run_failed', {
          artistId: artist.id,
          cycle: greetingOpenCycle,
          runId,
          hasInsertedGreetingMessage,
          errorMessage
        });

        const fallbackConversationId =
          introConversationId.trim() ||
          resolveModeSelectSessionHubConversation({
            requireEmptyConversation: true
          })?.id ||
          '';
        if (
          !shouldInsertGreetingFallbackAfterFailure({
            hasInsertedGreetingMessage,
            isRunActive: isRunActive(),
            introConversationId: fallbackConversationId
          })
        ) {
          return;
        }

        const fallbackSessionState = useStore.getState();
        const fallbackActivityContext = deriveGreetingActivityContext(fallbackSessionState, artist.id, language);
        const fallbackAvailableModes = buildAvailableModesForGreeting(artist, language);
        const fallbackShouldUseTutorial =
          GREETING_FORCE_TUTORIAL ||
          (fallbackSessionState.greetedArtistIds.size === 0 &&
            !fallbackSessionState.completedTutorials.greeting);
        const fallbackGreetingText = buildFallbackGreetingText(
          artist,
          language,
          preferredName,
          fallbackAvailableModes,
          fallbackShouldUseTutorial,
          {
            recentActivityFacts: fallbackActivityContext.recentActivityFacts,
            askActivityFeedback: fallbackActivityContext.askActivityFeedback,
            lastGreetingSnippet: fallbackActivityContext.lastGreetingSnippet,
            recentExperienceName: fallbackActivityContext.recentExperienceName,
            recentExperienceType: fallbackActivityContext.recentExperienceType,
            activityFeedbackCue: fallbackActivityContext.activityFeedbackCue
          }
        );
        if (!fallbackGreetingText.trim()) {
          logModeSelectDebugTrace('greeting_run_fallback_empty', {
            artistId: artist.id,
            cycle: greetingOpenCycle,
            runId
          });
          return;
        }

        commitBoundConversationId(fallbackConversationId, 'missing_context');
        const liveActiveConversationId = useStore.getState().activeConversationId;
        if (liveActiveConversationId !== fallbackConversationId) {
          setActiveConversation(fallbackConversationId);
        }

        const fallbackMessageId = generateId('msg');
        addMessage(fallbackConversationId, {
          id: fallbackMessageId,
          conversationId: fallbackConversationId,
          role: 'artist',
          content: fallbackGreetingText,
          status: 'complete',
          timestamp: new Date().toISOString(),
          metadata: {
            injected: true,
            tutorialMode: fallbackShouldUseTutorial,
            injectedType: fallbackShouldUseTutorial ? 'tutorial_greeting' : 'greeting',
            greetingActivitySnapshot: fallbackActivityContext.currentSnapshot
          }
        });
        markArtistGreeted(artist.id);
        autoMicManualOverrideRef.current = false;
        setPendingAutoMicGreetingMessageId(fallbackMessageId);
        setReplayBarrier({
          conversationId: fallbackConversationId,
          messageId: fallbackMessageId
        });
        hasInsertedGreetingMessage = true;
        updateConversation(
          fallbackConversationId,
          {
            lastMessagePreview: fallbackGreetingText.slice(0, 120),
            title: fallbackGreetingText.slice(0, 30)
          },
          artist.id
        );
        setGreeting(fallbackGreetingText);
        setPendingGreetingAudio(null);
        logModeSelectDebugTrace('greeting_run_fallback_inserted', {
          artistId: artist.id,
          cycle: greetingOpenCycle,
          runId,
          conversationId: fallbackConversationId
        });
      } finally {
        finalizeGreetingRun({
          runId,
          cycleKey,
          hasInsertedGreetingMessage,
          allowCycleReopen: !hasInsertedGreetingMessage && !isRunActive(),
          reason: isCancelled
            ? 'cancelled'
            : activeGreetingRunIdRef.current === runId
              ? hasInsertedGreetingMessage
                ? 'completed'
                : 'completed_without_insert'
              : 'superseded'
        });
      }
    };

    void runGreeting();
    return () => {
      isCancelled = true;
      finalizeGreetingRun({
        runId,
        cycleKey,
        hasInsertedGreetingMessage,
        allowCycleReopen: !hasInsertedGreetingMessage,
        reason: 'cleanup'
      });
    };
  }, [
    accessToken,
    addMessage,
    artist,
    commitBoundConversationId,
    conversationModeEnabled,
    enqueueGreetingVoiceNotice,
    finalizeGreetingRun,
    greetingOpenCycle,
    isModeSelectScreenFocused,
    isQuotaBlocked,
    language,
    markArtistGreeted,
    preferredName,
    resolveModeSelectSessionHubConversation,
    setActiveConversation,
    updateMessage,
    updateConversation,
    voiceAutoPlay
  ]);

  // Native: retry greeting playback once the audio player is idle (no browser autoplay gate).
  useEffect(() => {
    if (Platform.OS === 'web') {
      return;
    }
    if (!isModeSelectScreenFocused || !pendingGreetingAudio) {
      return;
    }
    if (
      !shouldAutoPlayPendingGreetingVoice({
        hasPendingGreetingAudio: Boolean(pendingGreetingAudio),
        conversationModeEnabled,
        voiceAutoPlayEnabled: voiceAutoPlay,
        forceAutoplay: pendingGreetingAudio.forceAutoplay,
        quotaBlocked: isQuotaBlocked
      })
    ) {
      setPendingGreetingAudio(null);
      return;
    }
    if (audioPlayer.isPlaying || audioPlayer.isLoading) {
      return;
    }
    const pendingAudio = pendingGreetingAudio;
    void (async () => {
      if (!modeSelectScreenFocusedRef.current) {
        return;
      }
      const playbackOutcome = await attemptGreetingAutoplayWithRetries({
        audioPlayer: audioPlayerRef.current,
        uri: pendingAudio.uri,
        messageId: pendingAudio.messageId
      });
      if (!modeSelectScreenFocusedRef.current) {
        return;
      }
      setPendingGreetingAudio(null);
      if (playbackOutcome.state === 'failed') {
        logModeSelectDebugTrace('greeting_autoplay_retry_native_failed_non_fatal', {
          conversationId: pendingAudio.conversationId,
          messageId: pendingAudio.messageId,
          failureReason: playbackOutcome.failureReason
        });
      }
    })();
  }, [
    audioPlayer.isLoading,
    audioPlayer.isPlaying,
    conversationModeEnabled,
    isModeSelectScreenFocused,
    isQuotaBlocked,
    pendingGreetingAudio,
    voiceAutoPlay
  ]);

  // Web: register a callback to play pending greeting audio on the next user gesture.
  // Deps exclude audioPlayer.isPlaying/isLoading — re-registering on audio state changes
  // would immediately fire the callback (session already unlocked) causing a double-play.
  useEffect(() => {
    if (Platform.OS !== 'web') {
      return;
    }
    if (!isModeSelectScreenFocused || !pendingGreetingAudio) {
      return;
    }
    if (
      !shouldAutoPlayPendingGreetingVoice({
        hasPendingGreetingAudio: Boolean(pendingGreetingAudio),
        conversationModeEnabled,
        voiceAutoPlayEnabled: voiceAutoPlay,
        forceAutoplay: pendingGreetingAudio.forceAutoplay,
        quotaBlocked: isQuotaBlocked
      })
    ) {
      setPendingGreetingAudio(null);
      return;
    }
    const pendingAudio = pendingGreetingAudio;
    queueLatestWebAutoplayUnlockRetry(() => {
      void (async () => {
        if (!modeSelectScreenFocusedRef.current) {
          return;
        }
        const playbackOutcome = await attemptGreetingAutoplayWithRetries({
          audioPlayer: audioPlayerRef.current,
          uri: pendingAudio.uri,
          messageId: pendingAudio.messageId
        });
        if (!modeSelectScreenFocusedRef.current) {
          return;
        }
        if (playbackOutcome.state === 'started' || playbackOutcome.state === 'failed') {
          setPendingGreetingAudio(null);
        }
        if (playbackOutcome.state === 'failed') {
          logModeSelectDebugTrace('greeting_autoplay_retry_failed_non_fatal', {
            conversationId: pendingAudio.conversationId,
            messageId: pendingAudio.messageId,
            failureReason: playbackOutcome.failureReason
          });
        }
      })();
    });
  }, [
    conversationModeEnabled,
    isModeSelectScreenFocused,
    isQuotaBlocked,
    pendingGreetingAudio,
    voiceAutoPlay
  ]);

  useEffect(() => {
    return () => {
      modeSelectScreenFocusedRef.current = false;
      shouldRestoreMicAfterBlurRef.current = false;
      activeGreetingRunIdRef.current = 0;
      stopModeSelectVoiceAndMic();
      clearSendContextRecoveryLock();
    };
  }, [clearSendContextRecoveryLock, stopModeSelectVoiceAndMic]);

  if (!artist) {
    return (
      <View style={styles.center} testID="mode-select-invalid-artist">
        <Text style={styles.errorText}>{t('invalidConversation')}</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: 'padding', default: undefined })}
      style={styles.screen}
      keyboardVerticalOffset={88}
    >
      <View style={styles.screen} ref={rootLayoutRef} onLayout={measureCategoryGridBottom}>
        <AmbientGlow variant="mode" />
        <View style={[styles.topRow, { paddingHorizontal: headerHorizontalInset }]}>
          <BackButton testID="mode-select-back" />
        </View>
        <ScrollView
          testID="mode-select-screen"
          style={styles.list}
          scrollEnabled={!shouldCompactModeGrid}
          contentContainerStyle={[
            styles.content,
            {
              paddingBottom: modeSelectScreenPaddingBottom
            }
          ]}
        >
          <View style={styles.header}>
            <Text style={styles.subtitle}>{artist.name}</Text>
            <Text style={styles.helperText}>{t('modeSelectCategoryEmptySubtitle')}</Text>
          </View>
          <View
            style={[styles.categoryGrid, shouldCompactModeGrid ? styles.categoryGridCompact : null]}
            ref={categoryGridRef}
            onLayout={measureCategoryGridBottom}
          >
            {MODE_CATEGORY_ORDER.map((categoryId, index) => (
              <CategoryMenuButton
                key={categoryId}
                artistId={artist.id}
                id={categoryId}
                index={index}
                compactProgress={modeGridCompactProgress}
                isCompact={shouldCompactModeGrid}
              />
            ))}
          </View>
        </ScrollView>

        {isValidConversation ? (
          <View
            pointerEvents="box-none"
            style={[styles.conversationOverlay, { bottom: modeSelectInputOffset, top: conversationOverlayTop }]}
          >
            <View style={[styles.conversationWindow, { maxHeight: chatWindowMaxHeight }]}>
              {showGreetingBootingIndicator ? (
                <View style={styles.greetingBootingIndicator} testID="mode-select-greeting-booting-indicator">
                  <View style={styles.greetingBootingDot} />
                  <Text style={styles.greetingBootingLabel}>{greetingBootingLabel}</Text>
                </View>
              ) : null}
              {isGreetingVoiceActive ? (
                <View
                  style={[
                    styles.greetingVoiceIndicator,
                    isGreetingVoicePendingGesture ? styles.greetingVoiceIndicatorBlocked : null
                  ]}
                >
                  <View
                    style={[
                      styles.greetingVoiceDot,
                      isGreetingVoicePendingGesture ? styles.greetingVoiceDotBlocked : null
                    ]}
                  />
                  <Text style={styles.greetingVoiceLabel}>{greetingVoiceLabel}</Text>
                </View>
              ) : null}
              <MessageList
                testID="mode-select-message-list"
                listKey={modeSelectConversationId}
                listStyle={styles.conversationList}
                contentContainerStyle={styles.conversationListContent}
                messages={messages}
                userDisplayName={userDisplayName}
                artistDisplayName={resolvedArtistDisplayName}
                onRetryMessage={retryMessage}
                onRetryVoice={retryVoiceForMessage}
                audioPlayer={audioPlayer}
                showEmptyState={false}
                forceFollowSignal={tailFollowRequestSignal}
                windowSize={24}
                initialNumToRender={48}
                maxToRenderPerBatch={48}
                removeClippedSubviews={false}
                disableVirtualization
                onTailFollowChanged={({ shouldFollowTail, distanceFromBottom }) => {
                  logModeSelectDebugTrace('tail_follow_changed', {
                    following: shouldFollowTail,
                    distanceFromBottom: Math.round(distanceFromBottom)
                  });
                }}
              />
              {hasStreaming ? <StreamingIndicator /> : null}
            </View>
          </View>
        ) : null}

        <View style={styles.modeSelectInputDock}>
          <View style={styles.modeSelectInputContent}>
                <ChatInput
              onSend={sendFromModeSelect}
              disabled={isModeSelectComposerDisabled}
              conversationMode={{
                enabled: conversationModeEnabled,
                isListening,
                transcript,
                error: conversationError,
                micState: conversationStatus,
                hint: conversationHint,
                onToggle: () => {
                  markWebAutoplaySessionUnlocked();
                  setConversationModeEnabled(true);
                },
                onPauseListening: handlePauseListening,
                onResumeListening: () => {
                  if (Platform.OS === 'web' && pendingGreetingAudio) {
                    // Play directly from this gesture handler (user activation context).
                    // Clear the queued callback first to prevent a double-play attempt.
                    clearPendingWebAutoplayUnlockRetry();
                    const pending = pendingGreetingAudio;
                    void audioPlayerRef.current.playQueue([pending.uri], {
                      messageId: pending.messageId
                    }).then((result) => {
                      if (result.started) {
                        setPendingGreetingAudio(null);
                      }
                    });
                  }
                  markWebAutoplaySessionUnlocked();
                  resumeListening();
                },
                onTypingStateChange: setHasTypedDraft
              }}
              onInputFocusChange={setIsInputFocused}
            />
          </View>
          {isValidConversation && isQuotaBlocked ? (
            <Text style={styles.blockedHint}>{t('chatInputBlocked')}</Text>
          ) : null}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background
  },
  list: {
    backgroundColor: 'transparent',
    flex: 1
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.xs
  },
  content: {
    padding: theme.spacing.md,
    paddingBottom: theme.spacing.xl * 2,
    width: '100%',
    maxWidth: 608,
    alignSelf: 'center'
  },
  header: {
    gap: 4,
    marginBottom: theme.spacing.md,
    paddingHorizontal: 2
  },
  subtitle: {
    color: theme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '700'
  },
  helperText: {
    color: theme.colors.textMuted,
    fontSize: 12,
    lineHeight: 16
  },
  conversationOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: theme.spacing.md,
    overflow: 'hidden'
  },
  conversationWindow: {
    width: '100%',
    maxWidth: 784,
    flex: 1,
    minHeight: 84,
    justifyContent: 'flex-end'
  },
  conversationList: {
    flex: 1
  },
  conversationListContent: {
    paddingTop: theme.spacing.xs,
    paddingBottom: theme.spacing.sm
  },
  greetingBootingIndicator: {
    alignSelf: 'flex-start',
    marginLeft: theme.spacing.md,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.neonBlueSoft,
    backgroundColor: 'rgba(10, 14, 24, 0.82)',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 5
  },
  greetingBootingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.textMuted
  },
  greetingBootingLabel: {
    color: theme.colors.textPrimary,
    fontSize: 11,
    fontWeight: '700'
  },
  greetingVoiceIndicator: {
    alignSelf: 'flex-start',
    marginLeft: theme.spacing.md,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.neonBlueSoft,
    backgroundColor: 'rgba(10, 14, 24, 0.82)',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 5
  },
  greetingVoiceIndicatorBlocked: {
    borderColor: theme.colors.accent
  },
  greetingVoiceDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.neonBlue
  },
  greetingVoiceDotBlocked: {
    backgroundColor: theme.colors.accent
  },
  greetingVoiceLabel: {
    color: theme.colors.textPrimary,
    fontSize: 11,
    fontWeight: '700'
  },
  modeSelectInputDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    paddingBottom: Platform.OS === 'ios' ? theme.spacing.sm : theme.spacing.xs
  },
  modeSelectInputContent: {
    width: '100%',
    maxWidth: 784,
    alignSelf: 'center'
  },
  blockedHint: {
    color: theme.colors.textSecondary,
    textAlign: 'center',
    fontSize: 12,
    marginTop: theme.spacing.xs
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: theme.spacing.sm
  },
  categoryGridCompact: {
    flexWrap: 'nowrap',
    rowGap: 0
  },
  categoryCard: {
    borderWidth: 1.7,
    borderRadius: 16,
    shadowColor: theme.colors.neonBlue,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4
  },
  categoryCardExpanded: {
    width: '48.5%'
  },
  categoryCardCompact: {
    width: '24%'
  },
  categoryPressable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.sm
  },
  categoryPressableHover: {
    backgroundColor: theme.colors.surfaceRaised
  },
  categoryPressablePressed: {
    opacity: 0.96
  },
  categoryEmoji: {
    fontSize: 36
  },
  categoryLabel: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center'
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.background
  },
  errorText: {
    color: theme.colors.error
  }
});
