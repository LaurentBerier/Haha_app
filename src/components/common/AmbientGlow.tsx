import { memo, useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

interface AmbientGlowProps {
  variant?: 'home' | 'mode';
}

function AmbientGlowBase({ variant = 'home' }: AmbientGlowProps) {
  const farOrbit = useRef(new Animated.Value(0)).current;
  const midOrbit = useRef(new Animated.Value(0)).current;
  const nearOrbit = useRef(new Animated.Value(0)).current;
  const glowPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animations = [
      Animated.loop(
        Animated.timing(farOrbit, {
          toValue: 1,
          duration: 68000,
          easing: Easing.linear,
          useNativeDriver: true
        })
      ),
      Animated.loop(
        Animated.timing(midOrbit, {
          toValue: 1,
          duration: 44000,
          easing: Easing.linear,
          useNativeDriver: true
        })
      ),
      Animated.loop(
        Animated.timing(nearOrbit, {
          toValue: 1,
          duration: 30000,
          easing: Easing.linear,
          useNativeDriver: true
        })
      ),
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowPulse, {
            toValue: 1,
            duration: 3600,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true
          }),
          Animated.timing(glowPulse, {
            toValue: 0,
            duration: 3600,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true
          })
        ])
      )
    ];

    animations.forEach((animation) => animation.start());

    return () => animations.forEach((animation) => animation.stop());
  }, [farOrbit, glowPulse, midOrbit, nearOrbit]);

  const isHome = variant === 'home';
  const pulseOpacity = glowPulse.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.66, 1, 0.7]
  });
  const pulseScale = glowPulse.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.94, 1.06, 0.95]
  });

  const farLayerStyle = {
    transform: [{ rotate: farOrbit.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }]
  } as const;
  const midLayerStyle = {
    transform: [{ rotate: midOrbit.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }]
  } as const;
  const nearLayerStyle = {
    transform: [{ rotate: nearOrbit.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }]
  } as const;

  return (
    <View pointerEvents="none" style={styles.container}>
      <Animated.View style={[styles.layer, styles.layerFar, isHome ? styles.homeFar : styles.modeFar, farLayerStyle]}>
        <Animated.View style={[styles.orb, styles.orbBlue, styles.orbHuge, { opacity: pulseOpacity }]} />
      </Animated.View>

      <Animated.View style={[styles.layer, styles.layerMid, isHome ? styles.homeMid : styles.modeMid, midLayerStyle]}>
        <Animated.View
          style={[styles.orb, styles.orbViolet, styles.orbLarge, { opacity: pulseOpacity, transform: [{ scale: pulseScale }] }]}
        />
      </Animated.View>

      <Animated.View
        style={[styles.layer, styles.layerNear, isHome ? styles.homeNear : styles.modeNear, nearLayerStyle]}
      >
        <Animated.View style={[styles.orb, styles.orbIndigo, styles.orbMid, { opacity: pulseOpacity }]} />
      </Animated.View>

      <View style={styles.vignette} />
    </View>
  );
}

export const AmbientGlow = memo(AmbientGlowBase);

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden'
  },
  layer: {
    position: 'absolute',
    width: 440,
    height: 440
  },
  layerFar: {
    opacity: 0.24
  },
  layerMid: {
    opacity: 0.2
  },
  layerNear: {
    opacity: 0.17
  },
  homeFar: {
    top: -210,
    right: -200
  },
  homeMid: {
    top: '14%',
    left: -220
  },
  homeNear: {
    bottom: -250,
    right: -220
  },
  modeFar: {
    top: -220,
    left: -220
  },
  modeMid: {
    top: '18%',
    right: -220
  },
  modeNear: {
    bottom: -240,
    left: -220
  },
  orb: {
    position: 'absolute',
    borderRadius: 999
  },
  orbHuge: {
    width: 420,
    height: 420
  },
  orbLarge: {
    width: 360,
    height: 360,
    left: 46,
    top: 40
  },
  orbMid: {
    width: 300,
    height: 300,
    left: 86,
    top: 72
  },
  // Decorative orb colors - intentionally not in theme.
  orbBlue: {
    backgroundColor: 'rgba(75, 112, 255, 0.2)'
  },
  orbViolet: {
    backgroundColor: 'rgba(125, 86, 255, 0.18)'
  },
  orbIndigo: {
    backgroundColor: 'rgba(47, 82, 219, 0.16)'
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(9, 13, 22, 0.16)'
  }
});
