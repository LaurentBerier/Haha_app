import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../../theme';

interface HeaderProps {
  title: string;
  subtitle?: string;
}

export function Header({ title, subtitle }: HeaderProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.xs
  },
  title: {
    ...theme.typography.title,
    color: theme.colors.textPrimary
  },
  subtitle: {
    ...theme.typography.caption,
    color: theme.colors.textMuted
  }
});
