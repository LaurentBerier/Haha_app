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
import { API_BASE_URL, CLAUDE_PROXY_URL, E2E_AUTH_BYPASS, GREETING_FORCE_TUTORIAL } from '../../../config/env';
import { useAutoReplayLastArtistMessage } from '../../../hooks/useAutoReplayLastArtistMessage';
import { useChat } from '../../../hooks/useChat';
import { useHeaderHorizontalInset } from '../../../hooks/useHeaderHorizontalInset';
import { useVoiceConversation } from '../../../hooks/useVoiceConversation';
import { t } from '../../../i18n';
import type { Message } from '../../../models/Message';
import { synthesizeVoice } from '../../../services/voiceEngine';
import { getRandomFillerUri, prewarmVoiceFillers } from '../../../services/voiceFillerService';
import { useStore } from '../../../store/useStore';
import { theme } from '../../../theme';
import { generateId } from '../../../utils/generateId';
import { stripAudioTags } from '../../../utils/audioTags';
import { findConversationById } from '../../../utils/conversationUtils';
import type { ChatSendPayload } from '../../../models/ChatSendPayload';

interface GreetingCoordinates {
  lat: number;
  lon: number;
}

interface GreetingEndpointResponse {
  greeting?: unknown;
  tutorial?: unknown;
}

interface GreetingTutorialInfo {
  active: boolean;
  sessionIndex: number;
  connectionLimit: number;
  modeNudgeAfterUserMessages: number;
}

interface GreetingFetchResult {
  greeting: string | null;
  tutorial: GreetingTutorialInfo | null;
}

interface PendingGreetingAudio {
  uri: string;
  messageId: string;
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
const GREETING_API_REQUEST_TIMEOUT_MS = 12_000;
const GREETING_API_MAX_ATTEMPTS = 2;
const GREETING_API_RETRY_DELAY_MS = 850;
const DEFAULT_TUTORIAL_CONNECTION_LIMIT = 3;
const DEFAULT_TUTORIAL_NUDGE_AFTER_MESSAGES = 2;
const GREETING_BOOTING_ROTATION_MS = 1_200;
const GREETING_BOOTING_FR_LINES = [
  "Chargement du cerveau de Cathy... attention, y'a du trafic",
  "Calibration du sarcasme... 92%... 104%... ok c'est trop tard",
  "Synchronisation avec ton sens de l'humour... erreur detectee",
  "Injection d'opinions non sollicitees... en cours"
] as const;
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

function hasVoiceAccess(accountType: string | null | undefined): boolean {
  if (typeof accountType !== 'string') {
    return false;
  }

  const normalized = accountType.trim().toLowerCase().replace(/[\s_-]+/g, '');
  return (
    normalized === 'regular' ||
    normalized === 'premium' ||
    normalized === 'admin' ||
    normalized === 'unlimited' ||
    normalized === 'proartist'
  );
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
  isTutorialGreeting: boolean
): string {
  const isEnglish = language.toLowerCase().startsWith('en');
  const displayName = preferredName ?? (isEnglish ? 'there' : 'toi');
  const nameStyle = classifyGreetingNameStyle(preferredName);
  const shouldAcknowledgeName = Boolean(preferredName) && nameStyle === 'unusual';
  const artistName = artist.name?.trim() || 'Cathy';
  const isCathyArtist = artistName.toLowerCase().includes('cathy');
  const variationIndex = Math.floor(Math.random() * 5);

  if (isTutorialGreeting) {
    if (isEnglish) {
      const intro = preferredName ? `Hey ${displayName}, how are you doing?` : 'Hey, how are you doing?';
      const nameBeat = shouldAcknowledgeName ? ' Your name is unique and I love it.' : '';
      return `${intro}${nameBeat} Voice conversation is already active: you can see the small lit mic at the bottom-right, so you can simply speak to interact with me. If you prefer texting, tap the mic to turn it off, then send me your texts.`;
    }

    const intro = preferredName ? `Hey ${displayName}, comment tu vas?` : 'Hey, comment tu vas?';
    const nameBeat = shouldAcknowledgeName ? " Ton prénom est original, j'aime ça." : '';
    return `${intro}${nameBeat} La conversation vocale est déjà active: tu vois le petit micro allumé en bas à droite, donc tu peux simplement parler pour interagir avec moi. Si tu préfères texter, clique sur le micro pour le couper, puis envoie-moi tes textos.`;
  }

  if (isEnglish) {
    const openingVariants = [
      `Hey ${displayName}, how are you? It's ${artistName} on the mic, yes, huge surprise, I know.`,
      `Hi ${displayName}, how's it going? ${artistName} here, same energy, slightly less sleep.`,
      `Yo ${displayName}, how are you doing? It's ${artistName}, still loud, still helpful.`
    ];
    const voiceSentenceVariants = ['The mic at the bottom is how you talk to me.'];
    const onboardingVariants = [
      "No pressure: start with one short line, and I'll guide the rest.",
      "We'll keep it simple, just tell me your vibe and we'll roll from there.",
      "Start wherever you want, I'll adapt fast and keep this fun."
    ];
    return [
      openingVariants[variationIndex % openingVariants.length] ?? openingVariants[0],
      voiceSentenceVariants[variationIndex % voiceSentenceVariants.length] ?? voiceSentenceVariants[0],
      onboardingVariants[variationIndex % onboardingVariants.length] ?? onboardingVariants[0]
    ]
      .filter(Boolean)
      .join(' ');
  }

  const openingVariants = isCathyArtist
    ? [
        `Hey ${displayName}, ça va? J'suis le clone de Cathy: même mordant, un rire de plus, pis juste assez de bugs pour être attachante.`,
        `Salut ${displayName}, tu vas bien? J'suis le clone de Cathy: copié-colle de la repartie, version un peu trop energique.`,
        `Yo ${displayName}, comment ça roule? J'suis le clone de Cathy: même sarcasme, même tempo, zéro bouton pause.`,
        `Salut ${displayName}, pret(e) ou pas? J'suis le clone de Cathy, edition turbo: j'arrive vite, j'parle franc, pis j'ris fort.`,
        `Bon ${displayName}, on s'le dit? J'suis le clone de Cathy: même queue de comète, juste un p'tit glitch dans l'attitude.`
      ]
    : [
        `Hey ${displayName}, ça va? J'suis ${artistName} au micro, pis j'arrive avec du jus.`,
        `Salut ${displayName}, tu vas bien? Moi c'est ${artistName}, pis oui, j'suis deja crinquee.`,
        `Yo ${displayName}, comment ça roule? C'est ${artistName}, pis on part ça smooth.`
      ];
  const voiceSentenceVariants = ["Le micro en bas permet de me parler direct."];
  const onboardingVariants = [
    "Aucune pression: lance juste une phrase, pis j't'accompagne pour le reste.",
    "On garde ça simple: dis-moi ton mood, pis j'te guide sans te brusquer.",
    "Commence où t'veux, j'm'ajuste vite pis on va avoir du fun."
  ];

  return [
    openingVariants[variationIndex % openingVariants.length] ?? openingVariants[0],
    voiceSentenceVariants[variationIndex % voiceSentenceVariants.length] ?? voiceSentenceVariants[0],
    onboardingVariants[variationIndex % onboardingVariants.length] ?? onboardingVariants[0]
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

function buildModeNudgeText(language: string, modeNames: string[]): string {
  const isEnglish = language.toLowerCase().startsWith('en');
  const shuffled = [...modeNames].sort(() => Math.random() - 0.5);
  const m1 = shuffled[0] ?? '';
  const m2 = shuffled[1] ?? '';
  const hasTwoModeExamples = Boolean(m1 && m2);

  if (isEnglish) {
    if (!hasTwoModeExamples) {
      const genericVariants: [string, string, string] = [
        `[sighs] We've been chatting for a bit. If you want to switch it up, check the modes at the top of the chat. Pick one if it fits your mood, or stay here with me.`,
        `[laughs] Quick reminder: you can try other modes up there anytime. Scroll up, pick one, or keep going here with me.`,
        `We can keep this going all day, but there are other modes waiting at the top. Take a look if you feel like changing pace.`
      ];
      return genericVariants[Math.floor(Math.random() * genericVariants.length)] ?? genericVariants[0];
    }

    const variants: [string, string, string] = [
      `[sighs] Hey, we've been chatting for a bit — if you feel like mixing it up, ${m1} or ${m2} might be your thing. Check the top of the chat, you'll see all the modes. Pick what sounds fun, or we can just keep going here too, no pressure.`,
      `[laughs] Okay we've been at this a while. Not complaining, but just so you know — there's ${m1}, ${m2} and more up there at the top. Take a look if you're curious. Or stay here, I don't mind either way.`,
      `Look, we can keep talking all day, but you should know ${m1} and ${m2} are just sitting there waiting. Scroll up, check the modes — pick one or don't, your call.`
    ];

    return variants[Math.floor(Math.random() * variants.length)] ?? variants[0];
  }

  if (!hasTwoModeExamples) {
    const genericVariants: [string, string, string] = [
      `[sighs] Ça fait un bout qu'on jase. Si t'as envie de changer d'ambiance, regarde les modes en haut du chat. Choisis-en un si ça t'allume, ou on continue ici.`,
      `[laughs] Petit rappel: t'as d'autres modes en haut quand tu veux. Monte voir ça, ou reste avec moi ici.`,
      `On peut continuer comme ça toute la journée, mais t'as d'autres modes qui t'attendent en haut. Jette un oeil si t'as envie de varier.`
    ];
    return genericVariants[Math.floor(Math.random() * genericVariants.length)] ?? genericVariants[0];
  }

  const variants: [string, string, string] = [
    `[sighs] Hey, ça fait quand même un moment qu'on jase — si t'as envie d'essayer de quoi, ${m1} ou ${m2} ça t'tenterait p'être. Regarde en haut du chat, t'as les différents modes là. Choisis c'qui t'intéresse, ou on continue juste à parler ici aussi, c'est correct.`,
    `[laughs] Bon, on se parle depuis un boutte. Je me plains pas, mais y'a ${m1}, ${m2} pis d'autres modes là-haut. Regarde ça si t'es curieux. Ou reste ici, ça me dérange pas pantoute.`,
    `Écoute, on peut jaser toute la journée, mais faut que tu saches que ${m1} pis ${m2} t'attendent là-haut. Scroll un peu, check les modes — choisis-en un ou pas, c'est toé qui décides.`
  ];

  return variants[Math.floor(Math.random() * variants.length)] ?? variants[0];
}

function parseGreetingTutorialInfo(value: unknown): GreetingTutorialInfo | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const active = raw.active === true;
  const sessionIndex = typeof raw.sessionIndex === 'number' && Number.isFinite(raw.sessionIndex)
    ? Math.max(0, Math.floor(raw.sessionIndex))
    : 0;
  const connectionLimit =
    typeof raw.connectionLimit === 'number' && Number.isFinite(raw.connectionLimit)
      ? Math.max(1, Math.floor(raw.connectionLimit))
      : DEFAULT_TUTORIAL_CONNECTION_LIMIT;
  const modeNudgeAfterUserMessages =
    typeof raw.modeNudgeAfterUserMessages === 'number' && Number.isFinite(raw.modeNudgeAfterUserMessages)
      ? Math.max(1, Math.floor(raw.modeNudgeAfterUserMessages))
      : DEFAULT_TUTORIAL_NUDGE_AFTER_MESSAGES;

  return {
    active,
    sessionIndex,
    connectionLimit,
    modeNudgeAfterUserMessages
  };
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
  isSessionFirstGreeting: boolean
): Promise<GreetingFetchResult> {
  const token = accessToken.trim();
  if (!token || shouldSkipGreetingApiCall()) {
    return {
      greeting: null,
      tutorial: null
    };
  }

  const payload: Record<string, unknown> = {
    artistId,
    language,
    availableModes,
    isSessionFirstGreeting
  };
  if (preferredName) {
    payload.preferredName = preferredName;
  }
  if (coords) {
    payload.coords = coords;
  }

  const candidates = buildGreetingEndpointCandidates();
  let shouldBackoff = false;
  for (let attempt = 0; attempt < GREETING_API_MAX_ATTEMPTS; attempt += 1) {
    for (const endpoint of candidates) {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), GREETING_API_REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload),
          signal: controller.signal
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
          return {
            greeting,
            tutorial: parseGreetingTutorialInfo(data.tutorial)
          };
        }
      } catch {
        shouldBackoff = true;
        // Try next endpoint candidate.
      } finally {
        clearTimeout(timeoutHandle);
      }
    }

    if (attempt < GREETING_API_MAX_ATTEMPTS - 1) {
      await delay(GREETING_API_RETRY_DELAY_MS);
    }
  }

  if (shouldBackoff) {
    markGreetingApiBackoff();
  }

  return {
    greeting: null,
    tutorial: null
  };
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
  const { height: viewportHeight } = useWindowDimensions();
  const headerHorizontalInset = useHeaderHorizontalInset();
  const [greeting, setGreeting] = useState<string | null>(null);
  const [hasTypedDraft, setHasTypedDraft] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [pendingAutoMicGreetingMessageId, setPendingAutoMicGreetingMessageId] = useState<string | null>(null);
  const [categoryGridBottomY, setCategoryGridBottomY] = useState<number | null>(null);
  const [isGreetingBooting, setIsGreetingBooting] = useState(false);
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
  const setVoiceAutoPlay = useStore((state) => state.setVoiceAutoPlay);
  const createConversation = useStore((state) => state.createConversation);
  const setActiveConversation = useStore((state) => state.setActiveConversation);
  const addMessage = useStore((state) => state.addMessage);
  const updateMessage = useStore((state) => state.updateMessage);
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
  const [pendingGreetingAudio, setPendingGreetingAudio] = useState<PendingGreetingAudio | null>(null);
  const [pendingGreetingSpeechText, setPendingGreetingSpeechText] = useState<string | null>(null);
  const [isWebSpeechFallbackActive, setIsWebSpeechFallbackActive] = useState(false);
  const modeGridCompactProgress = useRef(new Animated.Value(0)).current;
  const rootLayoutRef = useRef<View>(null);
  const categoryGridRef = useRef<View>(null);
  const messageListRef = useRef<FlatList<Message>>(null);
  const isNearBottomRef = useRef(true);
  const hasScrolledInitiallyRef = useRef(false);
  const greetingPlaybackCheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const greetingGestureRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const greetingSpeechHintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoMicTriggeredGreetingIdsRef = useRef<Set<string>>(new Set());
  const autoMicManualOverrideRef = useRef(false);
  const modeNudgeShownRef = useRef(false);
  const modeSelectInputOffset = Platform.select({ ios: 108, default: 96 }) ?? 96;
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
  const sendFromModeSelect = useCallback(
    (payload: ChatSendPayload) => {
      const shouldUseVoiceFiller = Boolean(
        conversationModeEnabled &&
          artist?.id &&
          accessToken.trim() &&
          hasVoiceAccess(sessionUser?.accountType ?? null)
      );

      if (shouldUseVoiceFiller && !audioPlayer.isPlaying && !audioPlayer.isLoading && artist?.id) {
        void getRandomFillerUri(artist.id, language, accessToken)
          .then((uri) => {
            if (!uri) {
              return;
            }
            if (!audioPlayer.isPlaying && !audioPlayer.isLoading) {
              void audioPlayer.play(uri);
            }
          })
          .catch(() => {
            // Non-blocking latency helper.
          });
      }

      return sendMessage(payload);
    },
    [accessToken, artist?.id, audioPlayer, conversationModeEnabled, language, sendMessage, sessionUser?.accountType]
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
    enabled: isValidConversation && conversationModeEnabled && !isQuotaBlocked,
    disabled: !isValidConversation || isQuotaBlocked,
    hasTypedDraft,
    isPlaying: audioPlayer.isPlaying || audioPlayer.isLoading || hasStreaming,
    onSend: (text) => {
      const normalized = text.trim();
      if (!normalized) {
        return;
      }
      sendFromModeSelect({ text: normalized });
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
  const isGreetingVoicePendingGesture = Boolean(pendingGreetingAudio || pendingGreetingSpeechText);
  const hasVisibleConversationText = messages.some(
    (message) => message.status === 'complete' && message.content.trim().length > 0
  );
  const isTutorialConversation = messages.some(
    (message) => message.role === 'artist' && message.metadata?.tutorialMode === true
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
    (audioPlayer.isLoading || audioPlayer.isPlaying || isGreetingVoicePendingGesture || isWebSpeechFallbackActive);
  const greetingVoiceLabel = isEnglishLanguage
    ? isGreetingVoicePendingGesture
      ? 'Tap anywhere to enable Cathy audio.'
      : 'Cathy is speaking...'
    : isGreetingVoicePendingGesture
      ? "Touchez l'écran pour activer la voix de Cathy."
      : 'Cathy parle...';
  const isNativeMobile = Platform.OS === 'ios' || Platform.OS === 'android';
  const fallbackOverlayTop = Math.floor(
    viewportHeight * (isNativeMobile && shouldCompactModeGrid ? 0.3 : Platform.OS === 'ios' ? 0.58 : 0.54)
  );
  const measuredOverlayTop =
    typeof categoryGridBottomY === 'number' ? Math.ceil(categoryGridBottomY + theme.spacing.sm) : fallbackOverlayTop;
  const mobileCompactOverlayMinTop = Math.max(theme.spacing.xl * 2, Math.floor(viewportHeight * 0.18));
  const minOverlayTop = Math.floor(viewportHeight * 0.46);
  const maxOverlayTop = Math.floor(viewportHeight * 0.75);
  const conversationOverlayTop =
    isNativeMobile && shouldCompactModeGrid
      ? Math.max(measuredOverlayTop, mobileCompactOverlayMinTop)
      : Math.min(Math.max(measuredOverlayTop, minOverlayTop), maxOverlayTop);
  const chatWindowMaxHeight = Math.max(
    160,
    Math.floor(viewportHeight - modeSelectInputOffset - conversationOverlayTop - theme.spacing.xs)
  );

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
    if (
      !conversationModeEnabled ||
      !artist?.id ||
      !accessToken.trim() ||
      !hasVoiceAccess(sessionUser?.accountType ?? null)
    ) {
      return;
    }

    prewarmVoiceFillers(artist.id, language, accessToken);
  }, [accessToken, artist?.id, conversationModeEnabled, language, sessionUser?.accountType]);

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

  useAutoReplayLastArtistMessage({
    messages,
    audioPlayer,
    enabled: isValidConversation,
    hasStreaming
  });

  useEffect(() => {
    setIsInputFocused(false);
    setIsGreetingBooting(false);
    setPendingAutoMicGreetingMessageId(null);
    autoMicManualOverrideRef.current = false;
    autoMicTriggeredGreetingIdsRef.current.clear();
    modeNudgeShownRef.current = false;
  }, [artistId]);

  useEffect(() => {
    const targetMessageId = pendingAutoMicGreetingMessageId;
    if (!targetMessageId) {
      return;
    }

    if (autoMicTriggeredGreetingIdsRef.current.has(targetMessageId)) {
      setPendingAutoMicGreetingMessageId(null);
      return;
    }

    if (autoMicManualOverrideRef.current) {
      autoMicTriggeredGreetingIdsRef.current.add(targetMessageId);
      setPendingAutoMicGreetingMessageId(null);
      return;
    }

    const targetMessage =
      messages.find((message) => message.id === targetMessageId && message.role === 'artist' && message.status === 'complete') ??
      null;
    const injectedType = targetMessage?.metadata?.injectedType;
    const isEligibleGreeting = injectedType === 'greeting' || injectedType === 'tutorial_greeting';
    if (!isEligibleGreeting) {
      return;
    }

    if (!isValidConversation || isQuotaBlocked || hasTypedDraft || hasStreaming) {
      return;
    }

    if (!conversationModeEnabled) {
      setConversationModeEnabled(true);
    }
    armListeningActivation();
    autoMicTriggeredGreetingIdsRef.current.add(targetMessageId);
    setPendingAutoMicGreetingMessageId(null);
  }, [
    armListeningActivation,
    conversationModeEnabled,
    hasStreaming,
    hasTypedDraft,
    isQuotaBlocked,
    isValidConversation,
    messages,
    pendingAutoMicGreetingMessageId,
    setConversationModeEnabled
  ]);

  const handlePauseListening = useCallback(() => {
    const pendingMessageId = pendingAutoMicGreetingMessageId;
    if (pendingMessageId && !autoMicTriggeredGreetingIdsRef.current.has(pendingMessageId)) {
      autoMicManualOverrideRef.current = true;
      autoMicTriggeredGreetingIdsRef.current.add(pendingMessageId);
      setPendingAutoMicGreetingMessageId(null);
    }
    pauseListening();
  }, [pauseListening, pendingAutoMicGreetingMessageId]);

  useEffect(() => {
    const hasInjectedModeNudge = messages.some(
      (message) => message.role === 'artist' && message.metadata?.injectedType === 'mode_nudge'
    );
    if (modeNudgeShownRef.current || hasInjectedModeNudge || !modeSelectConversationId || hasStreaming || !artist) {
      return;
    }

    const userMessages = messages.filter((message) => message.role === 'user' && message.status === 'complete');
    const modeNudgeThreshold = isTutorialConversation ? DEFAULT_TUTORIAL_NUDGE_AFTER_MESSAGES : 4;
    if (userMessages.length < modeNudgeThreshold) {
      return;
    }

    modeNudgeShownRef.current = true;

    const modeNames = buildAvailableModesForGreeting(artist).filter((name) => {
      const normalized = name.trim().toLowerCase();
      return normalized !== 'on jase' && normalized !== 'chat';
    });

    const rawNudgeText = buildModeNudgeText(language, modeNames);
    const nudgeText = stripAudioTags(rawNudgeText, { trim: true });
    if (!nudgeText) {
      return;
    }

    const nudgeMessageId = generateId('msg');
    addMessage(modeSelectConversationId, {
      id: nudgeMessageId,
      conversationId: modeSelectConversationId,
      role: 'artist',
      content: nudgeText,
      status: 'complete',
      timestamp: new Date().toISOString(),
      metadata: {
        injected: true,
        injectedType: 'mode_nudge'
      }
    });

    if (!accessToken.trim() || !rawNudgeText.trim()) {
      return;
    }

    updateMessage(modeSelectConversationId, nudgeMessageId, {
      metadata: {
        injected: true,
        injectedType: 'mode_nudge',
        voiceStatus: 'generating'
      }
    });

    void synthesizeVoice(rawNudgeText, artist.id, language, accessToken, { purpose: 'reply' })
      .then((nudgeVoiceUri) => {
        if (!nudgeVoiceUri) {
          updateMessage(modeSelectConversationId, nudgeMessageId, {
            metadata: {
              injected: true,
              injectedType: 'mode_nudge',
              voiceStatus: undefined
            }
          });
          return;
        }

        updateMessage(modeSelectConversationId, nudgeMessageId, {
          metadata: {
            injected: true,
            injectedType: 'mode_nudge',
            voiceUrl: nudgeVoiceUri,
            voiceQueue: [nudgeVoiceUri],
            voiceStatus: 'ready'
          }
        });

        const latestAudioState = audioStateRef.current;
        if (voiceAutoPlay && !latestAudioState.isPlaying && !latestAudioState.isLoading) {
          void audioPlayer.play(nudgeVoiceUri, { messageId: nudgeMessageId });
        }
      })
      .catch(() => {
        updateMessage(modeSelectConversationId, nudgeMessageId, {
          metadata: {
            injected: true,
            injectedType: 'mode_nudge',
            voiceStatus: undefined
          }
        });
      });
  }, [
    accessToken,
    addMessage,
    artist,
    audioPlayer,
    hasStreaming,
    isTutorialConversation,
    language,
    messages,
    modeSelectConversationId,
    updateMessage,
    voiceAutoPlay
  ]);

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
      setIsGreetingBooting(false);
      return;
    }

    clearGreetingPlaybackCheck();
    clearGreetingGestureRetry();
    clearGreetingSpeechHint();

    let isCancelled = false;
    const runGreeting = async () => {
      const sessionStateBeforeGreeting = useStore.getState();
      if (sessionStateBeforeGreeting.greetedArtistIds.has(artist.id)) {
        setIsGreetingBooting(false);
        return;
      }
      setIsGreetingBooting(true);
      let hasInsertedGreetingMessage = false;

      try {
        const isSessionFirstGreeting = sessionStateBeforeGreeting.greetedArtistIds.size === 0;
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

        const fetchedResult = await fetchGreetingFromApi(
          artist.id,
          language,
          accessToken,
          coords,
          availableModes,
          preferredName,
          isSessionFirstGreeting
        );
        const fallbackTutorialMode = isSessionFirstGreeting;
        const isTutorialConversationForMetadata = fetchedResult.tutorial?.active ?? fallbackTutorialMode;
        const isTutorialGreetingCopy = isTutorialConversationForMetadata || GREETING_FORCE_TUTORIAL;
        const greetingMetadata = {
          injected: true,
          tutorialMode: isTutorialConversationForMetadata,
          injectedType: isTutorialConversationForMetadata ? 'tutorial_greeting' : 'greeting'
        } as const;
        const nextGreeting =
          fetchedResult.greeting ??
          buildFallbackGreetingText(artist, language, preferredName, availableModes, isTutorialGreetingCopy);
        if (isCancelled || !nextGreeting) {
          return;
        }

        const now = new Date().toISOString();
        const greetingMessageId = generateId('msg');
        addMessage(introConversation.id, {
          id: greetingMessageId,
          conversationId: introConversation.id,
          role: 'artist',
          content: nextGreeting,
          status: 'complete',
          timestamp: now,
          metadata: greetingMetadata
        });
        autoMicManualOverrideRef.current = false;
        setPendingAutoMicGreetingMessageId(greetingMessageId);
        hasInsertedGreetingMessage = true;
        setIsGreetingBooting(false);
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
          updateMessage(introConversation.id, greetingMessageId, {
            metadata: {
              ...greetingMetadata,
              voiceStatus: 'generating'
            }
          });
          const greetingAudioUri = await synthesizeVoice(nextGreeting, artist.id, language, accessToken, {
            purpose: 'greeting'
          });
          if (isCancelled) {
            return;
          }

          updateMessage(introConversation.id, greetingMessageId, {
            metadata: {
              ...greetingMetadata,
              voiceUrl: greetingAudioUri,
              voiceQueue: [greetingAudioUri],
              voiceStatus: 'ready'
            }
          });
          void playGreetingAudio(greetingAudioUri, { messageId: greetingMessageId });
          if (Platform.OS === 'web') {
            clearGreetingPlaybackCheck();
            greetingPlaybackCheckTimeoutRef.current = setTimeout(() => {
              const audioState = audioStateRef.current;
              if (audioState.isPlaying || audioState.isLoading || audioState.currentUri === greetingAudioUri) {
                return;
              }
              if (!speakGreetingWithWebFallback(nextGreeting, language)) {
                setPendingGreetingAudio({
                  uri: greetingAudioUri,
                  messageId: greetingMessageId
                });
                setPendingGreetingSpeechText(nextGreeting);
              } else {
                pulseGreetingSpeechHint(estimateGreetingSpeechDurationMs(nextGreeting));
              }
            }, 900);
          }
        } catch (error) {
          if (!isCancelled) {
            updateMessage(introConversation.id, greetingMessageId, {
              metadata: {
                ...greetingMetadata,
                voiceStatus: undefined
              }
            });

            const status =
              typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
                ? error.status
                : null;
            const isQuotaOrRateError = status === 429 || status === 403;

            // Keep Cathy identity: do not switch to generic Web Speech when TTS is quota/rate-limited.
            if (Platform.OS === 'web' && !isQuotaOrRateError) {
              if (!speakGreetingWithWebFallback(nextGreeting, language)) {
                setPendingGreetingSpeechText(nextGreeting);
              } else {
                pulseGreetingSpeechHint(estimateGreetingSpeechDurationMs(nextGreeting));
              }
            }
          }
        }
      } catch {
        if (!isCancelled) {
          setIsGreetingBooting(false);
        }
      } finally {
        if (!isCancelled && !hasInsertedGreetingMessage) {
          setIsGreetingBooting(false);
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
    updateMessage,
    updateConversation
  ]);

  useEffect(() => {
    if (
      Platform.OS !== 'web' ||
      (!pendingGreetingAudio && !pendingGreetingSpeechText) ||
      typeof document === 'undefined'
    ) {
      return;
    }

    const handleFirstGesture = () => {
      const pendingAudio = pendingGreetingAudio;
      const speechText = pendingGreetingSpeechText;
      setPendingGreetingAudio(null);
      setPendingGreetingSpeechText(null);

      if (pendingAudio) {
        void audioPlayer.play(pendingAudio.uri, { messageId: pendingAudio.messageId });
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
  }, [audioPlayer, clearGreetingGestureRetry, language, pendingGreetingAudio, pendingGreetingSpeechText, pulseGreetingSpeechHint]);

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
      <View style={styles.screen} ref={rootLayoutRef} onLayout={measureCategoryGridBottom}>
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
              onSend={sendFromModeSelect}
              disabled={!isValidConversation || isQuotaBlocked}
              conversationMode={{
                enabled: conversationModeEnabled,
                isListening,
                transcript,
                error: conversationError,
                micState: conversationStatus,
                hint: conversationHint,
                onToggle: () => {
                  setConversationModeEnabled(!conversationModeEnabled);
                },
                onPauseListening: handlePauseListening,
                onResumeListening: resumeListening,
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
