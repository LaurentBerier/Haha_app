import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  KeyboardAvoidingView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions
} from 'react-native';
import { ChatBubble } from '../../../components/chat/ChatBubble';
import { ChatInput } from '../../../components/chat/ChatInput';
import { StreamingIndicator } from '../../../components/chat/StreamingIndicator';
import { AmbientGlow } from '../../../components/common/AmbientGlow';
import { BackButton } from '../../../components/common/BackButton';
import { MODE_IDS } from '../../../config/constants';
import { MODE_CATEGORY_META, MODE_CATEGORY_ORDER, type ModeCategoryId } from '../../../config/modeCategories';
import { getModeById } from '../../../config/modes';
import { API_BASE_URL, CLAUDE_PROXY_URL, E2E_AUTH_BYPASS } from '../../../config/env';
import { useChat } from '../../../hooks/useChat';
import { useHeaderHorizontalInset } from '../../../hooks/useHeaderHorizontalInset';
import { useVoiceConversation } from '../../../hooks/useVoiceConversation';
import { t } from '../../../i18n';
import type { Message } from '../../../models/Message';
import { synthesizeVoice } from '../../../services/voiceEngine';
import { useStore } from '../../../store/useStore';
import { theme } from '../../../theme';
import { generateId } from '../../../utils/generateId';
import { findConversationById } from '../../../utils/conversationUtils';

interface GreetingCoordinates {
  lat: number;
  lon: number;
}

interface GreetingEndpointResponse {
  greeting?: unknown;
}

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
const DEFAULT_GREETING_TYPING_DURATION_MS = 4_200;
const GREETING_API_BACKOFF_MS = 5 * 60_000;
let greetingApiBackoffUntilTs = 0;

interface ArtistModeSource {
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

function speakGreetingWithWebFallback(text: string, language: string): boolean {
  if (Platform.OS !== 'web') {
    return false;
  }

  const normalized = text.trim();
  if (!normalized) {
    return false;
  }

  const speechScope = globalThis as {
    speechSynthesis?: {
      cancel: () => void;
      speak: (utterance: unknown) => void;
      getVoices?: () => Array<{ lang?: string; name?: string }>;
    };
    SpeechSynthesisUtterance?: new (text: string) => {
      lang: string;
      rate: number;
      pitch: number;
      voice?: unknown;
    };
  };

  if (!speechScope.speechSynthesis || typeof speechScope.SpeechSynthesisUtterance !== 'function') {
    return false;
  }

  try {
    const synth = speechScope.speechSynthesis;
    const utterance = new speechScope.SpeechSynthesisUtterance(normalized);
    const targetLang = language.toLowerCase().startsWith('en') ? 'en' : 'fr';
    utterance.lang = targetLang === 'en' ? 'en-CA' : 'fr-CA';
    utterance.rate = 1;
    utterance.pitch = 1;

    const voices = synth.getVoices?.() ?? [];
    const matchingVoice = voices.find((voice) => voice.lang?.toLowerCase().startsWith(targetLang));
    if (matchingVoice) {
      utterance.voice = matchingVoice;
    }

    synth.cancel();
    synth.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

function buildFallbackGreetingText(
  artist: ArtistModeSource,
  language: string,
  preferredName: string | null,
  _availableModes: string[],
  includeVoiceHint: boolean
): string {
  const isEnglish = language.toLowerCase().startsWith('en');
  const displayName = preferredName ?? (isEnglish ? 'there' : 'toi');
  const artistName = artist.name?.trim() || 'Cathy';
  const variationIndex = Math.floor(Math.random() * 3);

  if (isEnglish) {
    const openingVariants = [
      `Hey ${displayName}, how are you? It's ${artistName}, yes, the loud one.`,
      `Hi ${displayName}, how's it going? ${artistName} here, no need to pretend you're surprised.`,
      `Yo ${displayName}, how are you doing? It's ${artistName} on the mic, obviously.`
    ];
    const voiceSentenceVariants = includeVoiceHint
      ? [
          'Voice mode is already on, and you can turn it off with the little mic at the bottom right if you prefer to text.',
          'We are already in voice mode; tap the small mic at the bottom right anytime depending on your communication preference.',
          'Conversation voice is active now, and the small mic at the bottom right lets you switch back to text whenever that feels better for you.'
        ]
      : ['Voice mode is already on.'];
    return [
      openingVariants[variationIndex] ?? openingVariants[0],
      voiceSentenceVariants[variationIndex] ?? voiceSentenceVariants[0]
    ]
      .filter(Boolean)
      .join(' ');
  }

  const openingVariants = [
    `Hey salut ${displayName}, comment tu vas? Moi c'est ${artistName}, j'imagine que tu l'avais déjà deviné.`,
    `Allô ${displayName}, ça va bien? ${artistName} au micro, grosse surprise, pas pantoute.`,
    `Salut ${displayName}, comment ça roule? Ici ${artistName}, ta notification la plus bavarde.`
  ];
  const voiceSentenceVariants = includeVoiceHint
    ? [
        'Le mode discussion vocale est déjà actif, et tu peux le couper avec le petit micro en bas à droite selon ta préférence de communication.',
        "On est déjà en mode vocal; touche le petit micro en bas à droite si tu préfères écrire.",
        'La conversation vocale tourne déjà, et le petit micro en bas à droite te laisse repasser en mode texte quand ça te convient mieux.'
      ]
    : ['Le mode discussion vocale est déjà actif.'];

  return [
    openingVariants[variationIndex] ?? openingVariants[0],
    voiceSentenceVariants[variationIndex] ?? voiceSentenceVariants[0]
  ]
    .filter(Boolean)
    .join(' ');
}

function estimateGreetingSpeechDurationMs(text: string): number {
  const normalized = text.trim();
  if (!normalized) {
    return DEFAULT_GREETING_TYPING_DURATION_MS;
  }

  const words = normalized.split(/\s+/).filter(Boolean).length;
  const estimated = Math.round((words / 2.8) * 1000);
  return Math.max(2_200, Math.min(estimated, 9_000));
}

function buildAvailableModesForGreeting(artist: ArtistModeSource): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  const modeIds = [MODE_IDS.ON_JASE, ...(artist.supportedModeIds ?? [])];

  modeIds.forEach((modeId) => {
    const modeName = getModeById(modeId)?.name?.trim();
    if (!modeName) {
      return;
    }

    const key = modeName.toLowerCase();
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    names.push(modeName);
  });

  return names.slice(0, 10);
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function isLocalWebHost(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return false;
  }

  const host = window.location.hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1';
}

function shouldSkipGreetingApiCall(): boolean {
  if (isLocalWebHost()) {
    return true;
  }

  return Date.now() < greetingApiBackoffUntilTs;
}

function markGreetingApiBackoff(): void {
  greetingApiBackoffUntilTs = Date.now() + GREETING_API_BACKOFF_MS;
}

function clearGreetingApiBackoff(): void {
  greetingApiBackoffUntilTs = 0;
}

function buildGreetingEndpointCandidates(): string[] {
  const isWebRuntime = typeof window !== 'undefined';
  const candidates: string[] = [];
  const addCandidate = (candidate: string) => {
    const normalized = candidate.trim();
    if (!normalized) {
      return;
    }
    if (!isWebRuntime && normalized.startsWith('/')) {
      return;
    }
    if (!candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  };

  if (isWebRuntime && typeof window.location?.origin === 'string' && window.location.origin) {
    const origin = normalizeUrl(window.location.origin);
    if (origin) {
      addCandidate(`${origin}/api/greeting`);
    }
    addCandidate('/api/greeting');
  }

  const apiBase = normalizeUrl(API_BASE_URL);
  if (apiBase) {
    addCandidate(`${apiBase}/greeting`);
  }

  const claudeProxy = normalizeUrl(CLAUDE_PROXY_URL);
  if (claudeProxy) {
    addCandidate(claudeProxy.replace(/\/claude$/, '/greeting'));
  }
  return candidates;
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

async function fetchGreetingFromApi(
  artistId: string,
  language: string,
  accessToken: string,
  coords: GreetingCoordinates | null,
  availableModes: string[],
  preferredName: string | null,
  includeVoiceHint: boolean
): Promise<string | null> {
  const token = accessToken.trim();
  if (!token || shouldSkipGreetingApiCall()) {
    return null;
  }

  const payload: Record<string, unknown> = {
    artistId,
    language,
    availableModes,
    includeVoiceHint
  };
  if (preferredName) {
    payload.preferredName = preferredName;
  }
  if (coords) {
    payload.coords = coords;
  }

  const candidates = buildGreetingEndpointCandidates();
  let shouldBackoff = false;
  for (const endpoint of candidates) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        if (response.status >= 500) {
          shouldBackoff = true;
        }
        continue;
      }

      const data = (await response.json()) as GreetingEndpointResponse;
      const greeting = typeof data.greeting === 'string' ? data.greeting.trim() : '';
      if (greeting) {
        clearGreetingApiBackoff();
        return greeting;
      }
    } catch {
      shouldBackoff = true;
      // Try next endpoint candidate.
    }
  }

  if (shouldBackoff) {
    markGreetingApiBackoff();
  }

  return null;
}

interface CategoryMenuButtonProps {
  artistId: string;
  id: ModeCategoryId;
  index: number;
}

function CategoryMenuButton({ artistId, id, index }: CategoryMenuButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const glow = useRef(new Animated.Value(0)).current;

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
        {
          transform: [{ scale }],
          backgroundColor,
          shadowOpacity,
          borderColor
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
        <Text style={styles.categoryEmoji}>{MODE_CATEGORY_META[id].emoji}</Text>
        <Text style={styles.categoryLabel}>{t(MODE_CATEGORY_META[id].labelKey)}</Text>
      </Pressable>
    </Animated.View>
  );
}

export default function ModeSelectHomeScreen() {
  const params = useLocalSearchParams<{ artistId: string }>();
  const artistId = params.artistId ?? '';
  const { height: viewportHeight } = useWindowDimensions();
  const headerHorizontalInset = useHeaderHorizontalInset();
  const [greeting, setGreeting] = useState<string | null>(null);
  const [hasTypedDraft, setHasTypedDraft] = useState(false);

  const artists = useStore((state) => state.artists);
  const language = useStore((state) => state.language);
  const accessToken = useStore((state) => state.session?.accessToken ?? '');
  const sessionUser = useStore((state) => state.session?.user ?? null);
  const userProfile = useStore((state) => state.userProfile);
  const activeConversationId = useStore((state) => state.activeConversationId);
  const conversationModeEnabled = useStore((state) => state.conversationModeEnabled);
  const setConversationModeEnabled = useStore((state) => state.setConversationModeEnabled);
  const setVoiceAutoPlay = useStore((state) => state.setVoiceAutoPlay);
  const createConversation = useStore((state) => state.createConversation);
  const setActiveConversation = useStore((state) => state.setActiveConversation);
  const addMessage = useStore((state) => state.addMessage);
  const updateConversation = useStore((state) => state.updateConversation);
  const markArtistGreeted = useStore((state) => state.markArtistGreeted);
  const hasArtistBeenGreetedThisSession = useStore(
    useCallback((state) => state.greetedArtistIds.has(artistId), [artistId])
  );
  const conversationsForArtist = useStore(
    useCallback((state) => state.conversations[artistId] ?? [], [artistId])
  );
  const artist = useMemo(() => artists.find((candidate) => candidate.id === artistId) ?? null, [artists, artistId]);
  const preferredName = useMemo(
    () =>
      resolveGreetingPreferredName({
        profilePreferredName: userProfile?.preferredName ?? null,
        displayName: sessionUser?.displayName ?? null,
        email: sessionUser?.email ?? null
      }),
    [sessionUser?.displayName, sessionUser?.email, userProfile?.preferredName]
  );
  const sortedOnJaseConversations = useMemo(
    () =>
      conversationsForArtist
        .filter((conversation) => (conversation.modeId ?? MODE_IDS.ON_JASE) === MODE_IDS.ON_JASE)
        .slice()
        .sort((left, right) => {
          const rightTime = Date.parse(right.updatedAt);
          const leftTime = Date.parse(left.updatedAt);
          return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
        }),
    [conversationsForArtist]
  );
  const modeSelectConversationId = useMemo(() => {
    if (!artistId) {
      return '';
    }

    if (!E2E_AUTH_BYPASS && !hasArtistBeenGreetedThisSession) {
      return '';
    }

    const activeConversation =
      activeConversationId && conversationsForArtist.some((conversation) => conversation.id === activeConversationId)
        ? findConversationById({ [artistId]: conversationsForArtist }, activeConversationId)
        : null;

    if (activeConversation && (activeConversation.modeId ?? MODE_IDS.ON_JASE) === MODE_IDS.ON_JASE) {
      return activeConversation.id;
    }

    return sortedOnJaseConversations[0]?.id ?? '';
  }, [activeConversationId, artistId, conversationsForArtist, hasArtistBeenGreetedThisSession, sortedOnJaseConversations]);
  const userDisplayName = formatUserDisplayName(sessionUser?.displayName ?? null, sessionUser?.email ?? null);
  const artistDisplayName = formatArtistDisplayName(artist?.name ?? null);
  const [pendingGreetingAudioUri, setPendingGreetingAudioUri] = useState<string | null>(null);
  const [pendingGreetingSpeechText, setPendingGreetingSpeechText] = useState<string | null>(null);
  const [isWebSpeechFallbackActive, setIsWebSpeechFallbackActive] = useState(false);
  const messageListRef = useRef<FlatList<Message>>(null);
  const isNearBottomRef = useRef(true);
  const hasScrolledInitiallyRef = useRef(false);
  const greetingPlaybackCheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const greetingGestureRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const greetingSpeechHintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modeSelectInputOffset = Platform.select({ ios: 108, default: 96 }) ?? 96;
  const chatWindowMaxHeight = Math.max(180, Math.floor(viewportHeight * 0.5));
  const {
    messages,
    sendMessage,
    retryMessage,
    hasStreaming,
    currentArtistName,
    isQuotaBlocked,
    audioPlayer
  } = useChat(modeSelectConversationId);
  const playGreetingAudio = audioPlayer.play;
  const isValidConversation = modeSelectConversationId.length > 0;
  const { isListening, transcript, error: conversationError, interruptAndListen } = useVoiceConversation({
    enabled: isValidConversation && conversationModeEnabled && !hasTypedDraft && !isQuotaBlocked,
    disabled: !isValidConversation || isQuotaBlocked,
    isPlaying: audioPlayer.isPlaying || audioPlayer.isLoading,
    onSend: (text) => {
      const normalized = text.trim();
      if (!normalized) {
        return;
      }
      sendMessage({ text: normalized });
    },
    onStopAudio: () => {
      void audioPlayer.stop();
    },
    language
  });
  const resolvedArtistDisplayName = formatArtistDisplayName(currentArtistName ?? artistDisplayName);
  const audioStateRef = useRef<{
    isPlaying: boolean;
    isLoading: boolean;
    currentUri: string | null;
  }>({
    isPlaying: false,
    isLoading: false,
    currentUri: null
  });
  const isGreetingVoicePendingGesture = Boolean(pendingGreetingAudioUri || pendingGreetingSpeechText);
  const isGreetingVoiceActive =
    greeting !== null &&
    (audioPlayer.isLoading || audioPlayer.isPlaying || isGreetingVoicePendingGesture || isWebSpeechFallbackActive);
  const greetingVoiceLabel = language.toLowerCase().startsWith('en')
    ? isGreetingVoicePendingGesture
      ? 'Tap anywhere to enable Cathy audio.'
      : 'Cathy is speaking...'
    : isGreetingVoicePendingGesture
      ? "Touchez l'écran pour activer la voix de Cathy."
      : 'Cathy parle...';

  const scrollToLatest = useCallback((animated: boolean) => {
    requestAnimationFrame(() => {
      messageListRef.current?.scrollToEnd({ animated });
    });
  }, []);

  const handleConversationContentSizeChange = useCallback(() => {
    if (!hasScrolledInitiallyRef.current) {
      hasScrolledInitiallyRef.current = true;
      scrollToLatest(false);
      return;
    }

    if (isNearBottomRef.current) {
      scrollToLatest(true);
    }
  }, [scrollToLatest]);

  const handleConversationScroll = useCallback(({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetY = nativeEvent.contentOffset?.y ?? 0;
    const contentHeight = nativeEvent.contentSize?.height ?? 0;
    const layoutHeight = nativeEvent.layoutMeasurement?.height ?? 0;
    const distanceFromBottom = contentHeight - (offsetY + layoutHeight);
    isNearBottomRef.current = distanceFromBottom < 80;
  }, []);

  const renderMessage = useCallback(
    ({ item }: { item: Message }) => (
      <ChatBubble
        message={item}
        userDisplayName={userDisplayName}
        artistDisplayName={resolvedArtistDisplayName}
        onRetryMessage={retryMessage}
        audioPlayer={audioPlayer}
      />
    ),
    [audioPlayer, resolvedArtistDisplayName, retryMessage, userDisplayName]
  );

  const clearGreetingPlaybackCheck = useCallback(() => {
    if (greetingPlaybackCheckTimeoutRef.current) {
      clearTimeout(greetingPlaybackCheckTimeoutRef.current);
      greetingPlaybackCheckTimeoutRef.current = null;
    }
  }, []);

  const clearGreetingGestureRetry = useCallback(() => {
    if (greetingGestureRetryTimeoutRef.current) {
      clearTimeout(greetingGestureRetryTimeoutRef.current);
      greetingGestureRetryTimeoutRef.current = null;
    }
  }, []);

  const clearGreetingSpeechHint = useCallback(() => {
    if (greetingSpeechHintTimeoutRef.current) {
      clearTimeout(greetingSpeechHintTimeoutRef.current);
      greetingSpeechHintTimeoutRef.current = null;
    }
    setIsWebSpeechFallbackActive(false);
  }, []);

  const pulseGreetingSpeechHint = useCallback((durationMs: number) => {
    clearGreetingSpeechHint();
    setIsWebSpeechFallbackActive(true);
    greetingSpeechHintTimeoutRef.current = setTimeout(() => {
      setIsWebSpeechFallbackActive(false);
      greetingSpeechHintTimeoutRef.current = null;
    }, Math.max(800, durationMs));
  }, [clearGreetingSpeechHint]);

  useEffect(() => {
    audioStateRef.current = {
      isPlaying: audioPlayer.isPlaying,
      isLoading: audioPlayer.isLoading,
      currentUri: audioPlayer.currentUri
    };
  }, [audioPlayer.currentUri, audioPlayer.isLoading, audioPlayer.isPlaying]);

  useEffect(() => {
    setVoiceAutoPlay(conversationModeEnabled);
  }, [conversationModeEnabled, setVoiceAutoPlay]);

  useEffect(() => {
    if (!modeSelectConversationId || activeConversationId === modeSelectConversationId) {
      return;
    }
    setActiveConversation(modeSelectConversationId);
  }, [activeConversationId, modeSelectConversationId, setActiveConversation]);

  useEffect(() => {
    if (!hasScrolledInitiallyRef.current || !isNearBottomRef.current) {
      return;
    }
    scrollToLatest(true);
  }, [messages, scrollToLatest]);

  useEffect(() => {
    if (!artist || !artistId || modeSelectConversationId) {
      return;
    }

    const sessionState = useStore.getState();
    const hasAlreadyGreeted = sessionState.greetedArtistIds.has(artist.id);
    if (!E2E_AUTH_BYPASS && !hasAlreadyGreeted) {
      return;
    }

    const conversation = createConversation(
      artist.id,
      resolveGreetingConversationLanguage(artist, language),
      MODE_IDS.ON_JASE
    );
    setActiveConversation(conversation.id);
  }, [artist, artistId, createConversation, language, modeSelectConversationId, setActiveConversation]);

  useEffect(() => {
    if (E2E_AUTH_BYPASS) {
      return;
    }

    if (!artist) {
      return;
    }

    const greetedArtistIds = useStore.getState().greetedArtistIds;
    if (greetedArtistIds.has(artist.id)) {
      return;
    }

    clearGreetingPlaybackCheck();
    clearGreetingGestureRetry();
    clearGreetingSpeechHint();

    let isCancelled = false;
    const runGreeting = async () => {
      const sessionStateBeforeGreeting = useStore.getState();
      if (sessionStateBeforeGreeting.greetedArtistIds.has(artist.id)) {
        return;
      }
      const includeVoiceHint = sessionStateBeforeGreeting.greetedArtistIds.size === 0;
      markArtistGreeted(artist.id);
      const introConversation = createConversation(
        artist.id,
        resolveGreetingConversationLanguage(artist, language),
        MODE_IDS.ON_JASE
      );
      setActiveConversation(introConversation.id);

      const availableModes = buildAvailableModesForGreeting(artist);
      const coords = await getOptionalCoords();
      if (isCancelled) {
        return;
      }

      const fetchedGreeting = await fetchGreetingFromApi(
        artist.id,
        language,
        accessToken,
        coords,
        availableModes,
        preferredName,
        includeVoiceHint
      );
      const nextGreeting =
        fetchedGreeting ?? buildFallbackGreetingText(artist, language, preferredName, availableModes, includeVoiceHint);
      if (isCancelled || !nextGreeting) {
        return;
      }

      const now = new Date().toISOString();
      addMessage(introConversation.id, {
        id: generateId('msg'),
        conversationId: introConversation.id,
        role: 'artist',
        content: nextGreeting,
        status: 'complete',
        timestamp: now
      });
      updateConversation(
        introConversation.id,
        {
          lastMessagePreview: nextGreeting.slice(0, 120),
          title: nextGreeting.slice(0, 30)
        },
        artist.id
      );

      setGreeting(nextGreeting);
      setPendingGreetingAudioUri(null);
      setPendingGreetingSpeechText(null);
      clearGreetingSpeechHint();

      if (!accessToken.trim()) {
        if (Platform.OS === 'web') {
          if (!speakGreetingWithWebFallback(nextGreeting, language)) {
            setPendingGreetingSpeechText(nextGreeting);
          } else {
            pulseGreetingSpeechHint(estimateGreetingSpeechDurationMs(nextGreeting));
          }
        }
        return;
      }

      try {
        const greetingAudioUri = await synthesizeVoice(nextGreeting, artist.id, language, accessToken, {
          purpose: 'greeting'
        });
        if (isCancelled) {
          return;
        }

        void playGreetingAudio(greetingAudioUri);
        if (Platform.OS === 'web') {
          clearGreetingPlaybackCheck();
          greetingPlaybackCheckTimeoutRef.current = setTimeout(() => {
            const audioState = audioStateRef.current;
            if (audioState.isPlaying || audioState.isLoading || audioState.currentUri === greetingAudioUri) {
              return;
            }
            if (!speakGreetingWithWebFallback(nextGreeting, language)) {
              setPendingGreetingAudioUri(greetingAudioUri);
              setPendingGreetingSpeechText(nextGreeting);
            } else {
              pulseGreetingSpeechHint(estimateGreetingSpeechDurationMs(nextGreeting));
            }
          }, 900);
        }
      } catch {
        if (!isCancelled) {
          if (Platform.OS === 'web') {
            if (!speakGreetingWithWebFallback(nextGreeting, language)) {
              setPendingGreetingSpeechText(nextGreeting);
            } else {
              pulseGreetingSpeechHint(estimateGreetingSpeechDurationMs(nextGreeting));
            }
          }
        }
      }
    };

    void runGreeting();
    return () => {
      isCancelled = true;
    };
  }, [
    accessToken,
    addMessage,
    artist,
    clearGreetingGestureRetry,
    clearGreetingPlaybackCheck,
    clearGreetingSpeechHint,
    createConversation,
    language,
    markArtistGreeted,
    preferredName,
    pulseGreetingSpeechHint,
    playGreetingAudio,
    setActiveConversation,
    updateConversation
  ]);

  useEffect(() => {
    if (
      Platform.OS !== 'web' ||
      (!pendingGreetingAudioUri && !pendingGreetingSpeechText) ||
      typeof document === 'undefined'
    ) {
      return;
    }

    const handleFirstGesture = () => {
      const uri = pendingGreetingAudioUri;
      const speechText = pendingGreetingSpeechText;
      setPendingGreetingAudioUri(null);
      setPendingGreetingSpeechText(null);

      if (uri) {
        void playGreetingAudio(uri);
      }

      if (speechText) {
        clearGreetingGestureRetry();
        greetingGestureRetryTimeoutRef.current = setTimeout(() => {
          const audioState = audioStateRef.current;
          if (audioState.isPlaying || audioState.isLoading) {
            return;
          }
          if (speakGreetingWithWebFallback(speechText, language)) {
            pulseGreetingSpeechHint(estimateGreetingSpeechDurationMs(speechText));
          }
        }, 420);
      }
    };

    document.addEventListener('pointerdown', handleFirstGesture, { once: true });
    return () => {
      document.removeEventListener('pointerdown', handleFirstGesture);
      clearGreetingGestureRetry();
    };
  }, [clearGreetingGestureRetry, language, pendingGreetingAudioUri, pendingGreetingSpeechText, playGreetingAudio, pulseGreetingSpeechHint]);

  useEffect(() => {
    return () => {
      clearGreetingPlaybackCheck();
      clearGreetingGestureRetry();
      clearGreetingSpeechHint();
    };
  }, [clearGreetingGestureRetry, clearGreetingPlaybackCheck, clearGreetingSpeechHint]);

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
      <View style={styles.screen}>
        <AmbientGlow variant="mode" />
        <View style={[styles.topRow, { paddingHorizontal: headerHorizontalInset }]}>
          <BackButton testID="mode-select-back" />
        </View>
        <ScrollView
          testID="mode-select-screen"
          style={styles.list}
          contentContainerStyle={[
            styles.content,
            {
              paddingBottom: chatWindowMaxHeight + modeSelectInputOffset + theme.spacing.xl
            }
          ]}
        >
          <View style={styles.header}>
            <Text style={styles.subtitle}>{artist.name}</Text>
            <Text style={styles.helperText}>{t('modeSelectCategoryEmptySubtitle')}</Text>
          </View>
          <View style={styles.categoryGrid}>
            {MODE_CATEGORY_ORDER.map((categoryId, index) => (
              <CategoryMenuButton key={categoryId} artistId={artist.id} id={categoryId} index={index} />
            ))}
          </View>
        </ScrollView>

        {isValidConversation ? (
          <View
            pointerEvents="box-none"
            style={[styles.conversationOverlay, { bottom: modeSelectInputOffset }]}
          >
            <View style={[styles.conversationWindow, { maxHeight: chatWindowMaxHeight }]}>
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
              <FlatList
                ref={messageListRef}
                testID="mode-select-message-list"
                style={styles.conversationList}
                contentContainerStyle={styles.conversationListContent}
                data={messages}
                keyExtractor={(item) => item.id}
                renderItem={renderMessage}
                windowSize={8}
                initialNumToRender={10}
                onContentSizeChange={handleConversationContentSizeChange}
                onScroll={handleConversationScroll}
                scrollEventThrottle={16}
              />
              {hasStreaming ? <StreamingIndicator /> : null}
            </View>
          </View>
        ) : null}

        <View style={styles.modeSelectInputDock}>
          <View style={styles.modeSelectInputContent}>
            <ChatInput
              onSend={sendMessage}
              disabled={!isValidConversation || isQuotaBlocked}
              conversationMode={{
                enabled: conversationModeEnabled,
                isListening,
                transcript,
                error: conversationError,
                isPlaying: audioPlayer.isPlaying || audioPlayer.isLoading,
                onToggle: () => {
                  setConversationModeEnabled(!conversationModeEnabled);
                },
                onInterrupt: interruptAndListen,
                onTypingStateChange: setHasTypedDraft
              }}
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
    minHeight: 84,
    justifyContent: 'flex-end'
  },
  conversationList: {
    flexGrow: 0
  },
  conversationListContent: {
    paddingTop: theme.spacing.xs,
    paddingBottom: theme.spacing.sm
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
  categoryCard: {
    width: '48.5%',
    minHeight: 118,
    borderWidth: 1.7,
    borderRadius: 16,
    shadowColor: theme.colors.neonBlue,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4
  },
  categoryPressable: {
    flex: 1,
    minHeight: 118,
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
