import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BackButton } from '../../../components/common/BackButton';
import { GameResultPanel } from '../../../components/games/GameResultPanel';
import { ImproStory } from '../../../components/games/ImproStory';
import { useImproChain } from '../../../games/hooks/useImproChain';
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

function buildThemeSuggestions(userProfile: UserProfile | null, language: string): string[] {
  const isEnglish = language.startsWith('en');
  const interests = Array.isArray(userProfile?.interests)
    ? userProfile.interests.map((interest) => normalizeThemeInput(interest)).filter(Boolean)
    : [];
  const primaryInterest = interests[0] ?? (isEnglish ? 'your weird hobbies' : 'tes passions bizarres');
  const secondaryInterest = interests[1] ?? (isEnglish ? 'your daily routine' : 'ta routine quotidienne');
  const horoscope = normalizeThemeInput(userProfile?.horoscopeSign ?? '');
  const preferredName = normalizeThemeInput(userProfile?.preferredName ?? '');
  const dayKey = new Date().toISOString().slice(0, 10);
  const seed = hashString(`${preferredName}|${primaryInterest}|${secondaryInterest}|${horoscope}|${dayKey}`);

  const qcPlaces = isEnglish
    ? ['Montreal metro', 'Centre Bell', 'Old Quebec']
    : ['metro de Montreal', 'Centre Bell', 'Vieux-Quebec'];
  const publicFigures = isEnglish
    ? ['a mayor in campaign mode', 'a loud hockey pundit', 'a TV host on live air']
    : ['un maire en campagne', 'un chroniqueur hockey trop confiant', 'une animatrice en direct'];
  const currentEvents = isEnglish
    ? ['a citywide outage', 'a viral trend gone wrong', 'an international summit that derails']
    : ['une panne geante', 'une tendance virale qui derape', 'un sommet international qui part en vrille'];
  const cathyHooks = isEnglish
    ? ['Cathy takes over the mic', 'Cathy runs the chaos like a stage manager', 'Cathy turns it into stand-up material']
    : ['Cathy prend le micro', 'Cathy gere le chaos comme une directrice de scene', 'Cathy transforme ca en number de stand-up'];

  const suggestionOne = isEnglish
    ? `${primaryInterest} collides with ${pick(currentEvents, seed, 1)} at the ${pick(qcPlaces, seed, 2)}, and ${pick(cathyHooks, seed, 3)}.`
    : `${primaryInterest} rencontre ${pick(currentEvents, seed, 1)} au ${pick(qcPlaces, seed, 2)}, puis ${pick(cathyHooks, seed, 3)}.`;

  const suggestionTwo = isEnglish
    ? `${secondaryInterest} explodes when ${pick(publicFigures, seed, 4)} calls you on live TV, and Cathy has to save the segment.`
    : `${secondaryInterest} explose quand ${pick(publicFigures, seed, 4)} t'appelle en direct, et Cathy doit sauver le segment.`;

  const suggestionThree = horoscope
    ? isEnglish
      ? `Your ${horoscope} sign gets a mission: survive ${pick(currentEvents, seed, 5)} in Quebec without losing your cool.`
      : `Ton signe ${horoscope} recoit une mission: survivre a ${pick(currentEvents, seed, 5)} au Quebec sans perdre ton sang-froid.`
    : isEnglish
      ? `Cathy drags you into a backstage Quebec comedy crisis with ${pick(publicFigures, seed, 6)} and zero preparation.`
      : `Cathy te traine dans une crise backstage d'humour au Quebec avec ${pick(publicFigures, seed, 6)} et zero preparation.`;

  return [suggestionOne, suggestionTwo, suggestionThree];
}

export default function ImproChainScreen() {
  const params = useLocalSearchParams<{ artistId: string }>();
  const artistId = params.artistId ?? '';
  const navigation = useNavigation();
  const headerHorizontalInset = useHeaderHorizontalInset();
  const [draft, setDraft] = useState('');
  const [selectedTheme, setSelectedTheme] = useState('');
  const [customTheme, setCustomTheme] = useState('');
  const artists = useStore((state) => state.artists);
  const userProfile = useStore((state) => state.userProfile);
  const language = useStore((state) => state.language);
  const artist = useMemo(() => artists.find((candidate) => candidate.id === artistId) ?? null, [artists, artistId]);
  const suggestedThemes = useMemo(() => buildThemeSuggestions(userProfile, language), [language, userProfile]);

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

  if (!artist) {
    return (
      <View style={styles.center} testID="impro-invalid-artist">
        <Text style={styles.errorText}>{t('invalidConversation')}</Text>
      </View>
    );
  }

  const resolvedTheme = normalizeThemeInput(customTheme) || normalizeThemeInput(selectedTheme);
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

            <View style={styles.themeGrid}>
              {suggestedThemes.map((themeOption) => {
                const active = normalizeThemeInput(selectedTheme) === themeOption && !normalizeThemeInput(customTheme);

                return (
                  <Pressable
                    key={`impro-theme-${themeOption}`}
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
                    testID={`impro-theme-${themeOption}`}
                  >
                    <Text style={[styles.themeChipLabel, active ? styles.themeChipLabelActive : null]}>{themeOption}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.customThemeLabel}>{t('gameLobbyTheme')}</Text>
            <TextInput
              value={customTheme}
              onChangeText={setCustomTheme}
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
  themeChip: {
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1.2,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSunken,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.sm
  },
  themeChipActive: {
    borderColor: theme.colors.neonBlue,
    backgroundColor: 'rgba(58, 141, 255, 0.12)'
  },
  themeChipLabel: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    fontWeight: '700'
  },
  themeChipLabelActive: {
    color: theme.colors.textPrimary
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
