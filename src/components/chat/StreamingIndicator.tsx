import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { t } from '../../i18n';
import { theme } from '../../theme';

export function StreamingIndicator() {
  const dotA = useRef(new Animated.Value(0.35)).current;
  const dotB = useRef(new Animated.Value(0.35)).current;
  const dotC = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const buildLoop = (value: Animated.Value, delayMs: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delayMs),
          Animated.timing(value, { toValue: 1, duration: 260, useNativeDriver: true }),
          Animated.timing(value, { toValue: 0.35, duration: 260, useNativeDriver: true })
        ])
      );

    const loops = [buildLoop(dotA, 0), buildLoop(dotB, 120), buildLoop(dotC, 240)];
    loops.forEach((loop) => loop.start());

    return () => loops.forEach((loop) => loop.stop());
  }, [dotA, dotB, dotC]);

  return (
    <View
      style={styles.container}
      testID="streaming-indicator"
      accessibilityLabel={t('streamingA11y')}
      accessibilityHint={t('streamingA11y')}
    >
      <Text style={styles.text}>{t('thinking')}</Text>
      <View style={styles.dots}>
        <Animated.View style={[styles.dot, { opacity: dotA }]} />
        <Animated.View style={[styles.dot, { opacity: dotB }]} />
        <Animated.View style={[styles.dot, { opacity: dotC }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.sm,
    paddingBottom: theme.spacing.sm,
    gap: theme.spacing.xs
  },
  text: {
    color: theme.colors.textMuted,
    fontStyle: 'italic',
    fontSize: 12
  },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: theme.colors.textMuted
  }
});
