import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useStore } from '../../store/useStore';
import { theme } from '../../theme';
import { getUserTitle } from '../../services/scoreManager';

export function ScoreBar() {
  const score = useStore((state) => state.score);
  const title = getUserTitle(score);

  return (
    <Pressable
      onPress={() => router.push('/stats')}
      style={({ pressed }) => [styles.container, pressed ? styles.pressed : null]}
      accessibilityRole="button"
      testID="scorebar-open-stats"
    >
      <View style={styles.row}>
        <Text style={styles.scoreLabel}>{`🔥 Score ${score}`}</Text>
        <Text style={styles.separator}>|</Text>
        <Text style={styles.titleLabel}>{`🎤 ${title}`}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: theme.spacing.xs,
    marginHorizontal: theme.spacing.md,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1.2,
    borderColor: theme.colors.neonBlueSoft,
    backgroundColor: theme.colors.surfaceRaised,
    shadowColor: theme.colors.neonBlue,
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 3
  },
  pressed: {
    opacity: 0.92
  },
  hovered: {
    borderColor: theme.colors.neonBlue,
    shadowOpacity: 0.42
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8
  },
  scoreLabel: {
    color: theme.colors.neonBlue,
    fontSize: 12,
    fontWeight: '700'
  },
  separator: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '600'
  },
  titleLabel: {
    color: theme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '700'
  }
});
