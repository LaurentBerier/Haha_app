import { StyleSheet, Text, View } from 'react-native';
import type { ImproTurn } from '../../games/types';
import { theme } from '../../theme';

interface ImproStoryProps {
  turns: ImproTurn[];
  streamingContent: string;
}

export function ImproStory({ turns, streamingContent }: ImproStoryProps) {
  const hasStreaming = Boolean(streamingContent.trim());

  return (
    <View style={styles.storyPanel}>
      {turns.map((turn, index) => (
        <View
          key={`impro-turn-${index}`}
          style={[
            styles.bubble,
            turn.role === 'user' ? styles.userBubble : styles.artistBubble
          ]}
        >
          <Text style={styles.roleLabel}>{turn.role === 'user' ? 'Toi' : 'Cathy'}</Text>
          <Text style={styles.content}>{turn.content}</Text>
        </View>
      ))}

      {hasStreaming ? (
        <View style={[styles.bubble, styles.artistBubble, styles.streamingBubble]}>
          <Text style={styles.roleLabel}>Cathy</Text>
          <Text style={styles.content}>{streamingContent}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  storyPanel: {
    borderWidth: 1.3,
    borderColor: theme.colors.border,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.sm,
    gap: theme.spacing.xs
  },
  bubble: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    gap: 4
  },
  userBubble: {
    alignSelf: 'flex-end',
    borderColor: theme.colors.neonBlueSoft,
    backgroundColor: theme.colors.surfaceRaised,
    maxWidth: '90%'
  },
  artistBubble: {
    alignSelf: 'flex-start',
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.artistBubble,
    maxWidth: '95%'
  },
  streamingBubble: {
    borderColor: theme.colors.neonBlue
  },
  roleLabel: {
    color: theme.colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  content: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    lineHeight: 19
  }
});

