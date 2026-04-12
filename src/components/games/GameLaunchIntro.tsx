import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { theme } from '../../theme';

interface GameLaunchIntroProps {
  title: string;
  subtitle: string;
  showTitle?: boolean;
  greetingText: string;
  isLoading: boolean;
  loadingLabel: string;
  ctaLabel: string;
  onPressCta: () => void;
  testIDPrefix: string;
}

export function GameLaunchIntro({
  title,
  subtitle,
  showTitle = true,
  greetingText,
  isLoading,
  loadingLabel,
  ctaLabel,
  onPressCta,
  testIDPrefix
}: GameLaunchIntroProps) {
  const trimmedGreeting = greetingText.trim();
  const shouldShowGreeting = !isLoading && trimmedGreeting.length > 0;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      testID={`${testIDPrefix}-launch-intro`}
    >
      <View style={styles.inner}>
        {showTitle ? (
          <>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </>
        ) : null}

        {isLoading ? (
          <View style={styles.loadingRow} testID={`${testIDPrefix}-launch-intro-loading`}>
            <LoadingSpinner />
            <Text style={styles.loadingLabel}>{loadingLabel}</Text>
          </View>
        ) : null}

        {shouldShowGreeting ? (
          <View style={styles.greetingBubble} testID={`${testIDPrefix}-launch-greeting-bubble`}>
            <Text style={styles.greetingText}>{trimmedGreeting}</Text>
          </View>
        ) : null}

        {!isLoading ? (
          <Pressable
            onPress={onPressCta}
            style={({ pressed }) => [styles.ctaButton, pressed ? styles.buttonPressed : null]}
            accessibilityRole="button"
            testID={`${testIDPrefix}-launch-intro-cta`}
          >
            <Text style={styles.ctaLabel}>{ctaLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1
  },
  content: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xl * 2,
    flexGrow: 1
  },
  inner: {
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
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    marginTop: theme.spacing.xs
  },
  loadingLabel: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700'
  },
  greetingBubble: {
    borderWidth: 1.2,
    borderColor: theme.colors.border,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm
  },
  greetingText: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '600'
  },
  ctaButton: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1.6,
    borderColor: theme.colors.neonBlue,
    backgroundColor: theme.colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: theme.spacing.xs
  },
  ctaLabel: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '700'
  },
  buttonPressed: {
    opacity: 0.9
  }
});
