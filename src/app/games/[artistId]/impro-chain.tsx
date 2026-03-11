import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BackButton } from '../../../components/common/BackButton';
import { GameResultPanel } from '../../../components/games/GameResultPanel';
import { ImproStory } from '../../../components/games/ImproStory';
import { useImproChain } from '../../../games/hooks/useImproChain';
import { useHeaderHorizontalInset } from '../../../hooks/useHeaderHorizontalInset';
import { t } from '../../../i18n';
import { useStore } from '../../../store/useStore';
import { theme } from '../../../theme';

export default function ImproChainScreen() {
  const params = useLocalSearchParams<{ artistId: string }>();
  const artistId = params.artistId ?? '';
  const navigation = useNavigation();
  const headerHorizontalInset = useHeaderHorizontalInset();
  const [draft, setDraft] = useState('');
  const artists = useStore((state) => state.artists);
  const artist = useMemo(() => artists.find((candidate) => candidate.id === artistId) ?? null, [artists, artistId]);

  const { game, turns, streamingContent, isStreaming, isComplete, startGame, submitTurn, abandon, clear } =
    useImproChain(artistId);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      if (!game) {
        return;
      }
      if (game.status === 'complete' || game.status === 'abandoned') {
        return;
      }

      event.preventDefault();
      Alert.alert(t('gameAbandon'), t('gameAbandonConfirmBody'), [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('gameAbandon'),
          style: 'destructive',
          onPress: () => {
            abandon();
            navigation.dispatch(event.data.action);
          }
        }
      ]);
    });

    return unsubscribe;
  }, [abandon, game, navigation]);

  if (!artist) {
    return (
      <View style={styles.center} testID="impro-invalid-artist">
        <Text style={styles.errorText}>{t('invalidConversation')}</Text>
      </View>
    );
  }

  const handleSubmit = async () => {
    const text = draft.trim();
    if (!text || isStreaming || game?.status === 'cathy-ending') {
      return;
    }
    setDraft('');
    await submitTurn(text);
  };

  const showComposer = Boolean(game && !isComplete && game.status !== 'cathy-ending');
  const showStart = !game || game.status === 'abandoned';

  return (
    <View style={styles.screen}>
      <View style={[styles.topRow, { paddingHorizontal: headerHorizontalInset }]}>
        <BackButton testID="impro-back" />
      </View>
      <ScrollView contentContainerStyle={styles.content} style={styles.scroll} testID="impro-screen">
        <Text style={styles.title}>{t('gameImproTitle')}</Text>
        <Text style={styles.subtitle}>{artist.name}</Text>

        {showStart ? (
          <Pressable
            onPress={() => void startGame()}
            style={({ hovered, pressed }) => [styles.startButton, hovered ? styles.buttonHover : null, pressed ? styles.buttonPressed : null]}
            accessibilityRole="button"
            testID="impro-start"
          >
            <Text style={styles.startLabel}>{t('gameLobbyGoButton')}</Text>
          </Pressable>
        ) : null}

        {game ? (
          <View style={styles.panel}>
            <ImproStory turns={turns} streamingContent={streamingContent} />

            {game.status === 'cathy-ending' ? (
              <Text style={styles.statusText}>{t('gameImproCathyEnding')}</Text>
            ) : isStreaming ? (
              <Text style={styles.statusText}>{t('gameImproCathyThinking')}</Text>
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
            scoreLabel={`${turns.length} tours`}
            replayLabel={t('gameImproReplay')}
            exitLabel={t('gameExit')}
            onReplay={() => void startGame()}
            onExit={() => {
              clear();
              router.back();
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
  statusText: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    fontWeight: '600'
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
  startButton: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1.6,
    borderColor: theme.colors.neonBlue,
    backgroundColor: theme.colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center'
  },
  startLabel: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '700'
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

