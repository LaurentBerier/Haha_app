import { StyleSheet, Text, View } from 'react-native';
import { t } from '../../i18n';
import { theme } from '../../theme';

export function StreamingIndicator() {
  return (
    <View
      style={styles.container}
      testID="streaming-indicator"
      accessibilityLabel={t('streamingA11y')}
      accessibilityHint={t('streamingA11y')}
    >
      <Text style={styles.text}>{t('thinking')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: theme.spacing.sm,
    paddingBottom: theme.spacing.sm
  },
  text: {
    color: theme.colors.textMuted,
    fontStyle: 'italic',
    fontSize: 12
  }
});
