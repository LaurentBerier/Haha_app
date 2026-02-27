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
        <View style={[styles.orb, styles.orbBlueTint, styles.orbMid]} />
      </Animated.View>

      <Animated.View style={[styles.layer, styles.layerMid, isHome ? styles.homeMid : styles.modeMid, midLayerStyle]}>
        <Animated.View style={[styles.orb, styles.orbViolet, styles.orbLarge, { opacity: pulseOpacity }]} />
        <Animated.View
          style={[
            styles.orb,
            styles.orbVioletTint,
            styles.orbSmall,
            {
              opacity: pulseOpacity,
              transform: [{ scale: pulseScale }]
            }
          ]}
        />
      </Animated.View>

      <Animated.View
        style={[styles.layer, styles.layerNear, isHome ? styles.homeNear : styles.modeNear, nearLayerStyle]}
      >
        <Animated.View style={[styles.orb, styles.orbIndigo, styles.orbLarge, { opacity: pulseOpacity }]} />
        <View style={[styles.orb, styles.orbIndigoTint, styles.orbSmall]} />
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
    width: 620,
    height: 620
  },
  layerFar: {
    opacity: 0.34
  },
  layerMid: {
    opacity: 0.28
  },
  layerNear: {
    opacity: 0.22
  },
  homeFar: {
    top: -270,
    right: -260
  },
  homeMid: {
    top: '12%',
    left: -290
  },
  homeNear: {
    bottom: -340,
    right: -300
  },
  modeFar: {
    top: -300,
    left: -300
  },
  modeMid: {
    top: '16%',
    right: -290
  },
  modeNear: {
    bottom: -320,
    left: -280
  },
  orb: {
    position: 'absolute',
    borderRadius: 999,
    shadowOpacity: 0.9,
    shadowRadius: 110,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8
  },
  orbHuge: {
    width: 600,
    height: 600
  },
  orbLarge: {
    width: 500,
    height: 500,
    left: 70,
    top: 40
  },
  orbMid: {
    width: 360,
    height: 360,
    left: 140,
    top: 120
  },
  orbSmall: {
    width: 300,
    height: 300,
    left: 170,
    top: 160
  },
  orbBlue: {
    backgroundColor: 'rgba(75, 112, 255, 0.28)',
    shadowColor: '#6A92FF'
  },
  orbBlueTint: {
    backgroundColor: 'rgba(94, 133, 255, 0.22)',
    shadowColor: '#86A8FF'
  },
  orbViolet: {
    backgroundColor: 'rgba(125, 86, 255, 0.26)',
    shadowColor: '#A579FF'
  },
  orbVioletTint: {
    backgroundColor: 'rgba(159, 98, 255, 0.2)',
    shadowColor: '#C196FF'
  },
  orbIndigo: {
    backgroundColor: 'rgba(47, 82, 219, 0.24)',
    shadowColor: '#5C88FF'
  },
  orbIndigoTint: {
    backgroundColor: 'rgba(72, 109, 240, 0.19)',
    shadowColor: '#7DA2FF'
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(9, 13, 22, 0.22)'
  }
});
