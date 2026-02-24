import { StyleSheet, Text, View } from 'react-native';
import { t } from '../../i18n';
import { theme } from '../../theme';

export function StreamingIndicator() {
  return (
    <View style={styles.container} testID="streaming-indicator">
      <Text style={styles.text}>{t('thinking')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.sm
  },
  text: {
    color: theme.colors.textMuted,
    fontStyle: 'italic'
  }
});
