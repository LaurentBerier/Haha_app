import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { t } from '../../i18n';
import { theme } from '../../theme';

interface LobbyPanelProps {
  roundCount: 3 | 5 | 7;
  themeValue: string;
  isCoinFlip: boolean;
  firstRoaster: 'user' | 'artist' | null;
  onRoundCountChange: (value: 3 | 5 | 7) => void;
  onThemeChange: (value: string) => void;
  onStart: () => void;
}

export function LobbyPanel({
  roundCount,
  themeValue,
  isCoinFlip,
  firstRoaster,
  onRoundCountChange,
  onThemeChange,
  onStart
}: LobbyPanelProps) {
  if (isCoinFlip) {
    return (
      <View style={styles.card} testID="roast-duel-coin-flip-panel">
        <Text style={styles.title}>{t('gameCoinFlipTitle')}</Text>
        <Text style={styles.coinResult}>
          {firstRoaster === 'artist' ? t('gameCoinFlipArtistFirst') : t('gameCoinFlipUserFirst')}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.card} testID="roast-duel-lobby-panel">
      <Text style={styles.title}>{t('gameRoastDuelTitle')}</Text>
      <Text style={styles.description}>{t('gameRoastDuelDescription')}</Text>

      <Text style={styles.label}>{t('gameLobbyRounds')}</Text>
      <View style={styles.segmentRow}>
        {[3, 5, 7].map((value) => (
          <Pressable
            key={value}
            onPress={() => onRoundCountChange(value as 3 | 5 | 7)}
            style={({ pressed }) => [
              styles.segmentButton,
              roundCount === value ? styles.segmentButtonActive : null,
              pressed ? styles.segmentButtonPressed : null
            ]}
            accessibilityRole="button"
            testID={`roast-duel-rounds-${value}`}
          >
            <Text style={[styles.segmentLabel, roundCount === value ? styles.segmentLabelActive : null]}>
              {String(value)}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>{t('gameLobbyTheme')}</Text>
      <TextInput
        value={themeValue}
        onChangeText={onThemeChange}
        style={styles.input}
        placeholder={t('gameLobbyThemePlaceholder')}
        placeholderTextColor={theme.colors.textDisabled}
        testID="roast-duel-theme-input"
      />

      <Pressable
        onPress={onStart}
        style={({ pressed }) => [styles.ctaButton, pressed ? styles.ctaButtonPressed : null]}
        accessibilityRole="button"
        testID="roast-duel-start"
      >
        <Text style={styles.ctaLabel}>{t('gameLobbyGoButton')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1.5,
    borderColor: theme.colors.neonBlueSoft,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    gap: theme.spacing.sm
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: 22,
    fontWeight: '800'
  },
  description: {
    color: theme.colors.textMuted,
    fontSize: 13,
    lineHeight: 18
  },
  label: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  segmentRow: {
    flexDirection: 'row',
    gap: theme.spacing.xs
  },
  segmentButton: {
    minWidth: 56,
    minHeight: 38,
    borderWidth: 1.2,
    borderColor: theme.colors.border,
    borderRadius: 10,
    backgroundColor: theme.colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center'
  },
  segmentButtonActive: {
    borderColor: theme.colors.neonBlue,
    backgroundColor: theme.colors.surfaceRaised
  },
  segmentButtonPressed: {
    opacity: 0.94
  },
  segmentLabel: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    fontWeight: '700'
  },
  segmentLabelActive: {
    color: theme.colors.textPrimary
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
  ctaButton: {
    marginTop: theme.spacing.xs,
    borderWidth: 1.6,
    borderColor: theme.colors.neonBlue,
    borderRadius: 12,
    backgroundColor: theme.colors.surfaceRaised,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.colors.neonBlue,
    shadowOpacity: 0.34,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4
  },
  ctaButtonPressed: {
    opacity: 0.94
  },
  ctaLabel: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '800'
  },
  coinResult: {
    color: theme.colors.neonBlue,
    fontSize: 18,
    fontWeight: '800'
  }
});
