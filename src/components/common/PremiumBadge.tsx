import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../../theme';
import { t } from '../../i18n';

export function PremiumBadge() {
  return (
    <View style={styles.badge}>
      <Text style={styles.label}>{t('premiumLabel')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.accent,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs
  },
  label: {
    color: theme.colors.accent,
    fontSize: 11,
    fontWeight: '700'
  }
});
