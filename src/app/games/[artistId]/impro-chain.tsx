import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BackButton } from '../../../components/common/BackButton';
import { GameResultPanel } from '../../../components/games/GameResultPanel';
import { ImproStory } from '../../../components/games/ImproStory';
import { useImproChain } from '../../../games/hooks/useImproChain';
import { ImproThemesService } from '../../../games/services/ImproThemesService';
import { useHeaderHorizontalInset } from '../../../hooks/useHeaderHorizontalInset';
import { t } from '../../../i18n';
import type { UserProfile } from '../../../models/UserProfile';
import { useStore } from '../../../store/useStore';
import { theme } from '../../../theme';

function normalizeThemeInput(value: string): string {
  return typeof value === 'string' ? value.trim() : '';
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

function buildFallbackThemes(userProfile: UserProfile | null, language: string, variationSeed = 0): ImproTheme[] {
  const isEnglish = language.startsWith('en');
  const preferredName = normalizeThemeInput(userProfile?.preferredName ?? '');
  const primaryInterest = normalizeThemeInput(userProfile?.interests?.[0] ?? '');
  const runtimeSalt = Math.floor(Math.random() * 1_000_000_000);
  const seed = hashString(`${preferredName}|${primaryInterest}|${Date.now()}|${variationSeed}|${runtimeSalt}`);

  const places = isEnglish
    ? [
        'at Granby Zoo',
        'at Parc Jean-Drapeau',
        'at Quartier Dix30',
        'in Old Quebec',
        'at Mont-Tremblant',
        'at Place des Arts',
        'at Montreal airport',
        'at the Bell Centre',
        'at a CEGEP in Montreal',
        'at a Costco in Laval'
      ]
    : [
        'au Zoo de Granby',
        'au Parc Jean-Drapeau',
        'au Quartier Dix30',
        'dans le Vieux-Quebec',
        'a Mont-Tremblant',
        'a Place des Arts',
        "a l'aeroport de Montreal",
        'au Centre Bell',
        'dans un cegep de Montreal',
        'dans un Costco a Laval'
      ];

  const incidents = isEnglish
    ? [
        'a peacock steals your backpack',
        'you get announced on stage by mistake',
        'your voice note plays on loudspeakers',
        'you become event captain by accident',
        'a live camera locks on you for ten minutes',
        'you must replace the host in 30 seconds',
        'a mascot starts following you everywhere',
        'your food order starts a crowd debate'
      ]
    : [
        'un paon te vole ton sac',
        'on t annonce sur scene par erreur',
        'ton vocal part sur les haut-parleurs',
        "tu deviens chef d'evenement sans le vouloir",
        'une camera live te suit pendant 10 minutes',
        'tu dois remplacer lanimateur dans 30 secondes',
        'une mascotte te suit partout',
        'ta commande de bouffe lance un debat dans la foule'
      ];

  const knownPeople = isEnglish
    ? [
        'Rachid Badouri',
        'Veronic DiCaire',
        'PY Lord',
        'Mitsou',
        'Sonia Benezra',
        'Patrick Huard',
        'Sugar Sammy',
        'Jean-Rene Dufort'
      ]
    : [
        'Rachid Badouri',
        'Veronic DiCaire',
        'PY Lord',
        'Mitsou',
        'Sonia Benezra',
        'Patrick Huard',
        'Sugar Sammy',
        'Jean-Rene Dufort'
      ];

  const titles = isEnglish
    ? [
        'Total chaos',
        'Wrong place, wrong time',
        'No plan, full panic',
        'Caught on live TV',
        'Instant improv crisis',
        'Public meltdown'
      ]
    : [
        'Chaos total',
        'Mauvaise place, mauvais timing',
        'Pas de plan, panique totale',
        'Pris en direct',
        'Crise improv instantanee',
        'Meltdown public'
      ];

  const selected: ImproTheme[] = [];
  for (let index = 0; index < 3; index += 1) {
    const place = pick(places, seed, index * 5 + 1);
    const incident = pick(incidents, seed, index * 5 + 2);
    const person = pick(knownPeople, seed, index * 5 + 3);
    const titleRoot = pick(titles, seed, index * 5 + 4);
    const title = `${titleRoot} #${index + 1}`;
    const premisse = isEnglish
      ? `You are ${place}, ${incident}, and ${person} says: "you fix this now".`
      : `Tu es ${place}, ${incident}, pis ${person} te dit: "c est toi qui gere ca la".`;

    selected.push({
      id: index + 1,
      type: 'universel',
      titre: title,
      premisse
    });
  }

  return selected;
}

export default function ImproChainScreen() {
  const params = useLocalSearchParams<{ artistId: string }>();
  const artistId = params.artistId ?? '';
  const navigation = useNavigation();
  const headerHorizontalInset = useHeaderHorizontalInset();
  const [draft, setDraft] = useState('');
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
  const language = useStore((state) => state.language);
  const artist = useMemo(() => artists.find((candidate) => candidate.id === artistId) ?? null, [artists, artistId]);

  const {
    game,
    turns,
    rewards,
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

  const handleBack = () => {
    if (game && game.status !== 'complete' && game.status !== 'abandoned') {
      abandon();
    }
    clear();
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(`/games/${artistId}`);
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', () => {
      if (!game) {
        return;
      }
      if (game.status !== 'complete' && game.status !== 'abandoned') {
        abandon();
      }
      clear();
    });

    return unsubscribe;
  }, [abandon, clear, game, navigation]);

  useEffect(() => {
    if (gameStatus !== 'none' && gameStatus !== 'abandoned') {
      return;
    }

    let cancelled = false;
    setThemesLoading(true);
    setThemesError(false);

    const fetchThemes = async () => {
      const firstNonce = Date.now() + themeSuggestionNonce * 997 + 1;
      const firstBatch = await ImproThemesService.fetchThemes({
        language,
        userProfile,
        nonce: firstNonce,
        avoidThemes: avoidThemesRef.current
      });

      let mergedThemes = firstBatch;

      if (mergedThemes.length < 4) {
        const secondNonce = firstNonce + 17;
        const topUpBatch = await ImproThemesService.fetchThemes({
          language,
          userProfile,
          nonce: secondNonce,
          avoidThemes: [...avoidThemesRef.current, ...toAvoidThemes(mergedThemes)]
        });
        mergedThemes = mergeUniqueThemes(mergedThemes, topUpBatch);
      }

      let nextThemes = mergedThemes.slice(0, 4);
      let nextFingerprint = createThemesFingerprint(nextThemes);

      if (nextThemes.length > 0 && nextFingerprint && nextFingerprint === lastThemesFingerprintRef.current) {
        const retryNonce = firstNonce + 37;
        const retryBatch = await ImproThemesService.fetchThemes({
          language,
          userProfile,
          nonce: retryNonce,
          avoidThemes: [...avoidThemesRef.current, ...toAvoidThemes(nextThemes)]
        });
        const retriedThemes = mergeUniqueThemes(retryBatch, nextThemes).slice(0, 4);
        if (retriedThemes.length > 0) {
          nextThemes = retriedThemes;
          nextFingerprint = createThemesFingerprint(nextThemes);
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

    void fetchThemes().catch(() => {
      if (cancelled) {
        return;
      }
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
  }, [gameStatus, language, themeSuggestionNonce, userProfile]);

  if (!artist) {
    return (
      <View style={styles.center} testID="impro-invalid-artist">
        <Text style={styles.errorText}>{t('invalidConversation')}</Text>
      </View>
    );
  }

  const normalizedCustomTheme = normalizeThemeInput(customTheme);
  const resolvedTheme = normalizedCustomTheme
    ? normalizedCustomTheme
    : selectedTheme
      ? `${selectedTheme.titre} - ${selectedTheme.premisse}`
      : '';
  const showLobby = !game || game.status === 'abandoned';
  const handleSubmit = async () => {
    const text = draft.trim();
    if (!text || isStreaming || game?.status === 'cathy-ending') {
      return;
    }
    setDraft('');
    await submitTurn(text);
  };

  const showComposer = Boolean(
    game && !isComplete && game.status !== 'cathy-ending' && userTurnsCount < targetUserTurns
  );
  const interventionsLeft = Math.max(0, targetUserTurns - userTurnsCount);

  return (
    <View style={styles.screen}>
      <View style={[styles.topRow, { paddingHorizontal: headerHorizontalInset }]}>
        <BackButton testID="impro-back" onPress={handleBack} />
      </View>
      <ScrollView contentContainerStyle={styles.content} style={styles.scroll} testID="impro-screen">
        <Text style={styles.title}>{t('gameImproTitle')}</Text>
        <Text style={styles.subtitle}>{artist.name}</Text>

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
                      style={({ hovered, pressed }) => [
                        styles.themeChip,
                        active ? styles.themeChipActive : null,
                        hovered ? styles.buttonHover : null,
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
                <Pressable
                  onPress={() => setThemeSuggestionNonce((previous) => previous + 1)}
                  style={({ hovered, pressed }) => [
                    styles.retryButton,
                    hovered ? styles.buttonHover : null,
                    pressed ? styles.buttonPressed : null
                  ]}
                  accessibilityRole="button"
                  testID="impro-themes-retry"
                >
                  <Text style={styles.retryButtonLabel}>{t('gameErrorRetry')}</Text>
                </Pressable>
              </View>
            ) : null}

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
              onPress={() => void startGame(resolvedTheme)}
              disabled={!resolvedTheme}
              style={({ hovered, pressed }) => [
                styles.startButton,
                hovered ? styles.buttonHover : null,
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

        {game && !showLobby ? (
          <View style={styles.panel}>
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

            <ImproStory turns={turns} rewards={rewards} streamingContent={streamingContent} />

            {game.status === 'cathy-ending' ? (
              <Text style={styles.statusText}>{t('gameImproCathyEnding')}</Text>
            ) : isStreaming ? (
              <Text style={styles.statusText}>{t('gameImproCathyThinking')}</Text>
            ) : !showComposer ? (
              <Text style={styles.statusText}>{t('gameImproCathyWrapHint')}</Text>
            ) : null}

            {showComposer ? (
              <View style={styles.composer}>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  style={styles.input}
                  placeholder={t('gameImproInputPlaceholder')}
                  placeholderTextColor={theme.colors.textDisabled}
                  editable={!isStreaming}
                  testID="impro-input"
                />
                <Pressable
                  onPress={() => void handleSubmit()}
                  disabled={!draft.trim() || isStreaming}
                  style={({ hovered, pressed }) => [
                    styles.sendButton,
                    hovered ? styles.buttonHover : null,
                    pressed ? styles.buttonPressed : null,
                    (!draft.trim() || isStreaming) ? styles.disabledButton : null
                  ]}
                  accessibilityRole="button"
                  testID="impro-send"
                >
                  <Text style={styles.sendLabel}>{t('gameImproSend')}</Text>
                </Pressable>
              </View>
            ) : null}
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
              setDraft('');
              setSelectedTheme(null);
              setCustomTheme('');
              setThemeSuggestionNonce((previous) => previous + 1);
            }}
            onExit={() => {
              clear();
              if (router.canGoBack()) {
                router.back();
                return;
              }
              router.replace(`/games/${artistId}`);
            }}
            testID="impro-result"
          />
        ) : null}
      </ScrollView>
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
  panel: {
    gap: theme.spacing.sm
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
    minHeight: 70,
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
    lineHeight: 16
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
  composer: {
    gap: theme.spacing.xs
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
  sendButton: {
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1.4,
    borderColor: theme.colors.neonBlueSoft,
    backgroundColor: theme.colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center'
  },
  sendLabel: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '700'
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
