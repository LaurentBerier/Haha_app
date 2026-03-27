import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../../theme';

interface ThreadModeHeaderProps {
  title: string;
  subtitle: string;
  testID?: string;
}

function ThreadModeHeaderBase({ title, subtitle, testID }: ThreadModeHeaderProps) {
  const normalizedTitle = title.trim();
  const normalizedSubtitle = subtitle.trim();

  if (!normalizedTitle && !normalizedSubtitle) {
    return null;
  }

  return (
    <View style={styles.container} testID={testID}>
      {normalizedTitle ? (
        <Text style={styles.title} numberOfLines={1}>{normalizedTitle}</Text>
      ) : null}
      {normalizedSubtitle ? (
        <Text style={styles.subtitle} numberOfLines={2}>
          {normalizedSubtitle}
        </Text>
      ) : null}
    </View>
  );
}

export const ThreadModeHeader = memo(ThreadModeHeaderBase);

const styles = StyleSheet.create({
  container: {
    marginHorizontal: theme.spacing.sm,
    marginBottom: theme.spacing.xs,
    gap: 4
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
  }
});
