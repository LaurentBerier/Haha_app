import { StyleSheet, Text, View } from 'react-native';
import type { ImproReward, ImproTurn } from '../../games/types';
import { theme } from '../../theme';

interface ImproStoryProps {
  turns: ImproTurn[];
  rewards: ImproReward[];
  streamingContent: string;
}

export function ImproStory({ turns, rewards, streamingContent }: ImproStoryProps) {
  const hasStreaming = Boolean(streamingContent.trim());
  const rewardByTurn = new Map<number, ImproReward>();
  rewards.forEach((reward) => {
    rewardByTurn.set(reward.userTurnNumber, reward);
  });

  const rows: Array<{
    key: string;
    role: 'user' | 'artist';
    label: string;
    content: string;
    reward?: ImproReward;
  }> = [];

  let userTurnCursor = 0;
  turns.forEach((turn, index) => {
    if (turn.role === 'user') {
      userTurnCursor += 1;
    }

    rows.push({
      key: `impro-turn-${index}`,
      role: turn.role,
      label: turn.role === 'user' ? 'Toi' : 'Cathy',
      content: turn.content,
      reward: turn.role === 'user' ? rewardByTurn.get(userTurnCursor) : undefined
    });
  });

  if (hasStreaming) {
    rows.push({
      key: 'impro-streaming-row',
      role: 'artist',
      label: 'Cathy',
      content: streamingContent
    });
  }

  return (
    <View style={styles.storyPanel}>
      <Text style={styles.sheetTitle}>Scenario en cours</Text>

      {rows.map((row) => (
        <View
          key={row.key}
          style={[
            styles.lineRow,
            row.role === 'user' ? styles.userRow : styles.artistRow
          ]}
        >
          <Text style={styles.roleLabel}>{row.label}:</Text>
          <Text style={styles.content}>{row.content}</Text>
          {row.reward ? (
            <Text style={styles.rewardLine}>
              {row.reward.emoji} +{row.reward.points} {row.reward.label}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  storyPanel: {
    borderWidth: 1.2,
    borderColor: theme.colors.border,
    borderRadius: 14,
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.neonBlueSoft,
    backgroundColor: 'rgba(248, 250, 255, 0.08)',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    gap: 0
  },
  sheetTitle: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: theme.spacing.xs
  },
  lineRow: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(148, 163, 184, 0.22)',
    paddingVertical: 8,
    gap: 4
  },
  userRow: {
    paddingLeft: 4
  },
  artistRow: {
    paddingLeft: 0
  },
  roleLabel: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '800'
  },
  content: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    lineHeight: 21
  },
  rewardLine: {
    color: theme.colors.neonBlue,
    fontSize: 12,
    fontWeight: '700'
  }
});
