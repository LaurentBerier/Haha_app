import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../hooks/useAuth';
import { t } from '../../i18n';
import { theme } from '../../theme';

function getAccountTypeLabel(accountType: string | null | undefined): string {
  if (accountType === 'regular') {
    return t('accountTypeRegular');
  }
  if (accountType === 'premium') {
    return t('accountTypePremium');
  }
  if (accountType === 'admin') {
    return t('accountTypeAdmin');
  }
  return t('accountTypeFree');
}

export default function SubscriptionScreen() {
  const { user } = useAuth();
  const accountTypeLabel = getAccountTypeLabel(user?.accountType);

  return (
    <View style={styles.screen} testID="settings-subscription-screen">
      <Text style={styles.title}>{t('settingsSubscription')}</Text>
      <Text style={styles.body}>{`${t('settingsCurrentSubscription')} ${accountTypeLabel}`}</Text>
      <Text style={styles.subtle}>{t('settingsSubscriptionComingSoon')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
    padding: theme.spacing.lg,
    gap: theme.spacing.sm
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: 24,
    fontWeight: '700'
  },
  body: {
    color: theme.colors.textPrimary,
    fontSize: 16
  },
  subtle: {
    color: theme.colors.textSecondary,
    fontSize: 14
  }
});
