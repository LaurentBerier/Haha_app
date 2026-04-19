import { useCallback, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../../theme';
import { t } from '../../i18n';
import { unlockIosAudioSessionSync } from '../../hooks/useAudioPlayer';
import { requestWebMicPermission, type WebMicPermissionOutcome } from '../../services/voiceEngine';
import { sttDebug } from '../../services/sttDebugLogger';

export interface VoiceSessionGateUnlockResult {
  micGranted: boolean;
  micDenied: boolean;
  micUnsupported: boolean;
  micTimedOut: boolean;
}

interface VoiceSessionGateOverlayProps {
  visible: boolean;
  onUnlock: (result: VoiceSessionGateUnlockResult) => void;
}

export function VoiceSessionGateOverlay({ visible, onUnlock }: VoiceSessionGateOverlayProps) {
  const [isRequesting, setIsRequesting] = useState(false);

  const handlePress = useCallback(async () => {
    if (isRequesting) return;
    setIsRequesting(true);
    sttDebug('[STT_DEBUG] gate: tap fired, unlocking audio synchronously');
    // Run audio unlock SYNCHRONOUSLY inside the user-activation before any
    // await, so AudioContext.resume() and the silent <audio> prime happen
    // with a live gesture. getUserMedia can follow — its permission popup
    // may pause async resolution but AudioContext is already running with
    // keep-alive oscillator.
    unlockIosAudioSessionSync();
    let outcome: WebMicPermissionOutcome;
    try {
      sttDebug('[STT_DEBUG] gate: requesting mic permission');
      outcome = await requestWebMicPermission();
      sttDebug(
        `[STT_DEBUG] gate: mic outcome granted=${outcome.granted} denied=${outcome.denied} timedOut=${outcome.timedOut} unsupported=${outcome.unsupported}`
      );
    } catch {
      outcome = { granted: false, denied: true, timedOut: false, unsupported: false };
    }
    sttDebug('[STT_DEBUG] gate: unlocked, releasing greeting effect');
    onUnlock({
      micGranted: outcome.granted,
      micDenied: outcome.denied,
      micUnsupported: outcome.unsupported,
      micTimedOut: outcome.timedOut
    });
  }, [isRequesting, onUnlock]);

  if (!visible || Platform.OS !== 'web') {
    return null;
  }

  return (
    <View style={styles.overlay} pointerEvents="box-only">
      <View style={styles.card}>
        <Text style={styles.title}>{t('voiceGateTitle')}</Text>
        <Text style={styles.subtitle}>{t('voiceGateSubtitle')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('voiceGateButton')}
          onPress={handlePress}
          disabled={isRequesting}
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
            isRequesting && styles.buttonDisabled
          ]}
        >
          <Text style={styles.buttonLabel}>
            {isRequesting ? t('voiceGateRequesting') : t('voiceGateButton')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(6, 8, 16, 0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    ...(Platform.OS === 'web' ? ({ position: 'fixed' } as object) : null)
  },
  card: {
    maxWidth: 420,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.xl,
    alignItems: 'center',
    gap: theme.spacing.md
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center'
  },
  subtitle: {
    color: theme.colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: theme.spacing.md
  },
  button: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: theme.colors.accent,
    borderWidth: 1.7,
    borderColor: theme.colors.neonBlue,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: theme.colors.neonBlue,
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 }
  },
  buttonPressed: {
    opacity: 0.85
  },
  buttonDisabled: {
    opacity: 0.6
  },
  buttonLabel: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '700'
  }
});
