import { memo, useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { theme } from '../../theme';

interface WaveformButtonProps {
  isPlaying: boolean;
  isLoading: boolean;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}

const BAR_COUNT = 4;
const ICON_SCALE = 1.05;
const IDLE_BAR_HEIGHT = 5 * ICON_SCALE;
const MIN_BAR_HEIGHT = 4 * ICON_SCALE;
const MAX_BAR_HEIGHT = 16 * ICON_SCALE;
const NEON_MAUVE = '#B56CFF';
const NEON_ROSE = '#FF4FD8';
const BAR_COLORS = [
  theme.colors.neonBlue,
  NEON_ROSE,
  NEON_MAUVE,
  theme.colors.neonBlue
] as const;

function resolveWaveBarColor(index: number): string {
  return BAR_COLORS[index % BAR_COLORS.length];
}

function WaveformButtonBase({ isPlaying, isLoading, onPress, disabled = false, testID }: WaveformButtonProps) {
  const bars = useRef(
    Array.from({ length: BAR_COUNT }, (_, index) => ({
      key: `wave-bar-${index}`,
      value: new Animated.Value(IDLE_BAR_HEIGHT)
    }))
  ).current;
  const loadingOpacity = useRef(new Animated.Value(1)).current;
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    return () => {
      animationRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    animationRef.current?.stop();
    animationRef.current = null;
    bars.forEach((bar) => {
      bar.value.stopAnimation();
      bar.value.setValue(IDLE_BAR_HEIGHT);
    });
    loadingOpacity.stopAnimation();
    loadingOpacity.setValue(1);

    if (isPlaying) {
      const loops = bars.map((bar, index) =>
        Animated.loop(
          Animated.sequence([
            Animated.timing(bar.value, {
              toValue: MAX_BAR_HEIGHT,
              duration: 300 + index * 60,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: false
            }),
            Animated.timing(bar.value, {
              toValue: MIN_BAR_HEIGHT,
              duration: 300 + index * 60,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: false
            })
          ])
        )
      );

      const stagger = Animated.stagger(80, loops);
      animationRef.current = stagger;
      stagger.start();
      return;
    }

    if (isLoading) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(loadingOpacity, {
            toValue: 0.4,
            duration: 300,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false
          }),
          Animated.timing(loadingOpacity, {
            toValue: 1,
            duration: 300,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false
          })
        ])
      );
      animationRef.current = loop;
      loop.start();
    }
  }, [bars, isLoading, isPlaying, loadingOpacity]);

  const shouldShowWaveform = isPlaying || isLoading;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        disabled ? styles.buttonDisabled : null,
        pressed && !disabled ? styles.buttonPressed : null
      ]}
      testID={testID}
      accessibilityRole="button"
    >
      {shouldShowWaveform ? (
        <View style={[styles.barsWrap, disabled ? styles.barsWrapDisabled : null]}>
          {bars.map((bar, index) => (
            <Animated.View
              key={bar.key}
              style={[
                styles.bar,
                index < BAR_COUNT - 1 ? styles.barSpacing : null,
                {
                  backgroundColor: resolveWaveBarColor(index),
                  height: bar.value,
                  opacity: isLoading ? loadingOpacity : 1
                }
              ]}
            />
          ))}
        </View>
      ) : (
        <View style={[styles.playIcon, disabled ? styles.playIconDisabled : null]} />
      )}
    </Pressable>
  );
}

export const WaveformButton = memo(WaveformButtonBase);

const styles = StyleSheet.create({
  button: {
    marginTop: theme.spacing.xs,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: NEON_MAUVE,
    width: 38,
    height: 38,
    borderRadius: 19,
    padding: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(181, 108, 255, 0.16)',
    shadowColor: NEON_ROSE,
    shadowOpacity: 0.55,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 7
  },
  buttonPressed: {
    opacity: 0.85
  },
  buttonDisabled: {
    opacity: 0.6
  },
  barsWrap: {
    width: 24 * ICON_SCALE,
    height: 18 * ICON_SCALE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center'
  },
  barsWrapDisabled: {
    opacity: 0.35
  },
  bar: {
    width: 3 * ICON_SCALE,
    borderRadius: 999
  },
  barSpacing: {
    marginRight: 3 * ICON_SCALE
  },
  playIcon: {
    marginLeft: 2 * ICON_SCALE,
    width: 0,
    height: 0,
    borderTopWidth: 7 * ICON_SCALE,
    borderBottomWidth: 7 * ICON_SCALE,
    borderLeftWidth: 11 * ICON_SCALE,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: NEON_ROSE
  },
  playIconDisabled: {
    opacity: 0.35
  }
});
