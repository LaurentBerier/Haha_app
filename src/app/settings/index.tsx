import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SettingsRow } from '../../components/common/SettingsRow';
import { useAuth } from '../../hooks/useAuth';
import { t } from '../../i18n';
import { deleteAccount, signOut } from '../../services/authService';
import { useStore } from '../../store/useStore';
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

function initialsFromIdentity(value: string | null | undefined): string {
  const input = (value ?? '').trim();
  if (!input) {
    return 'HH';
  }

  const tokens = input.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    return `${tokens[0]?.charAt(0) ?? ''}${tokens[1]?.charAt(0) ?? ''}`.toUpperCase();
  }

  return input.slice(0, 2).toUpperCase();
}

export default function SettingsScreen() {
  const { user, session } = useAuth();
  const clearSession = useStore((state) => state.clearSession);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const email = user?.email ?? '';
  const identity = user?.displayName ?? email;
  const initials = useMemo(() => initialsFromIdentity(identity), [identity]);
  const accountTypeLabel = getAccountTypeLabel(user?.accountType);

  const doLogout = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await signOut();
      clearSession();
      router.replace('/(auth)/login');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t('settingsGenericError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(t('settingsLogout'), t('settingsLogoutConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('settingsLogout'), style: 'destructive', onPress: () => void doLogout() }
    ]);
  };

  const doDeleteAccount = async () => {
    if (!session?.accessToken) {
      setErrorMessage(t('settingsGenericError'));
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await deleteAccount(session.accessToken);
      clearSession();
      router.replace('/(auth)/login');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t('settingsDeleteError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(t('settingsDeleteAccount'), t('settingsDeleteConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('settingsDeleteAccount'), style: 'destructive', onPress: () => void doDeleteAccount() }
    ]);
  };

  return (
    <ScrollView contentContainerStyle={styles.screen} testID="settings-screen">
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarLabel}>{initials}</Text>
        </View>
        <Text style={styles.email}>{email || t('settingsUnknownEmail')}</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeLabel}>{accountTypeLabel}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settingsAccount')}</Text>
        <View style={styles.group}>
          <SettingsRow
            label={t('settingsEditProfile')}
            onPress={() => router.push('/settings/edit-profile' as never)}
            testID="settings-edit-profile"
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settingsSubscription')}</Text>
        <View style={styles.group}>
          <SettingsRow
            label={t('settingsManageSubscription')}
            value={accountTypeLabel}
            onPress={() => router.push('/settings/subscription' as never)}
            testID="settings-manage-subscription"
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('settingsDanger')}</Text>
        <View style={styles.group}>
          <SettingsRow
            label={t('settingsLogout')}
            onPress={handleLogout}
            isDestructive
            showChevron={false}
            testID="settings-logout"
          />
          <SettingsRow
            label={t('settingsDeleteAccount')}
            onPress={handleDeleteAccount}
            isDestructive
            showChevron={false}
            testID="settings-delete-account"
          />
        </View>
      </View>

      {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

      {isSubmitting ? (
        <Pressable style={[styles.blocker]} pointerEvents="none">
          <Text style={styles.blockerLabel}>{t('loadingA11y')}</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    padding: theme.spacing.lg,
    gap: theme.spacing.lg,
    backgroundColor: theme.colors.background,
    minHeight: '100%'
  },
  profileCard: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.lg,
    alignItems: 'center',
    gap: theme.spacing.sm
  },
  avatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center'
  },
  avatarLabel: {
    color: theme.colors.textPrimary,
    fontSize: 24,
    fontWeight: '700'
  },
  email: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '600'
  },
  badge: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceRaised,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs
  },
  badgeLabel: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700'
  },
  section: {
    gap: theme.spacing.sm
  },
  sectionTitle: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  group: {
    gap: theme.spacing.sm
  },
  errorText: {
    color: theme.colors.error,
    fontSize: 14
  },
  blocker: {
    marginTop: theme.spacing.sm,
    alignSelf: 'center'
  },
  blockerLabel: {
    color: theme.colors.textMuted,
    fontSize: 13
  }
});
