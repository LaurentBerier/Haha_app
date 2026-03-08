import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme } from 'react-native';
import { useToast } from '../../components/common/ToastProvider';
import { SettingsRow } from '../../components/common/SettingsRow';
import { t } from '../../i18n';
import { deleteAccount, signOut } from '../../services/authService';
import type { AppLanguage, DisplayMode } from '../../store/slices/uiSlice';
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
  const session = useStore((state) => state.session);
  const user = session?.user ?? null;
  const clearSession = useStore((state) => state.clearSession);
  const language = useStore((state) => state.language);
  const displayMode = useStore((state) => state.displayMode);
  const setLanguagePreference = useStore((state) => state.setLanguagePreference);
  const setDisplayMode = useStore((state) => state.setDisplayMode);
  const systemColorScheme = useColorScheme();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const toast = useToast();

  const email = user?.email ?? '';
  const identity = user?.displayName ?? email;
  const initials = useMemo(() => initialsFromIdentity(identity), [identity]);
  const accountTypeLabel = getAccountTypeLabel(user?.accountType);
  const languageOptions: Array<{ value: AppLanguage; label: string }> = [
    { value: 'fr-CA', label: t('settingsLanguageFr') },
    { value: 'en-CA', label: t('settingsLanguageEn') }
  ];
  const displayModeOptions: Array<{ value: DisplayMode; label: string }> = [
    { value: 'dark', label: t('settingsDisplayDark') },
    { value: 'light', label: t('settingsDisplayLight') },
    { value: 'system', label: t('settingsDisplaySystem') }
  ];
  const effectiveDisplayMode = displayMode === 'system' ? (systemColorScheme === 'light' ? 'light' : 'dark') : displayMode;

  const doLogout = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await signOut();
      clearSession();
      router.replace('/(auth)/login');
    } catch (error) {
      const message = error instanceof Error ? error.message : t('settingsGenericError');
      setErrorMessage(message);
      toast.error(message);
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
      const message = error instanceof Error ? error.message : t('settingsDeleteError');
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteAccount = () => {
    setDeleteConfirmInput('');
    setShowDeleteConfirm((current) => !current);
  };

  const isDeleteConfirmValid = deleteConfirmInput.trim().toUpperCase() === 'DELETE';

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
        <Text style={styles.sectionTitle}>{t('settingsPreferences')}</Text>
        <View style={styles.preferenceCard}>
          <Text style={styles.preferenceLabel}>{t('settingsLanguage')}</Text>
          <View style={styles.choiceRow}>
            {languageOptions.map((option) => (
              <Pressable
                key={option.value}
                onPress={() => setLanguagePreference(option.value)}
                style={[styles.choiceChip, language === option.value ? styles.choiceChipActive : null]}
                testID={`settings-language-${option.value}`}
              >
                <Text style={[styles.choiceChipLabel, language === option.value ? styles.choiceChipLabelActive : null]}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.preferenceCard}>
          <Text style={styles.preferenceLabel}>{t('settingsDisplayMode')}</Text>
          <View style={styles.choiceRow}>
            {displayModeOptions.map((option) => (
              <Pressable
                key={option.value}
                onPress={() => setDisplayMode(option.value)}
                style={[styles.choiceChip, displayMode === option.value ? styles.choiceChipActive : null]}
                testID={`settings-display-${option.value}`}
              >
                <Text style={[styles.choiceChipLabel, displayMode === option.value ? styles.choiceChipLabelActive : null]}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
          {displayMode === 'system' ? (
            <Text style={styles.preferenceHint}>{`${t('settingsDisplaySystem')} (${effectiveDisplayMode})`}</Text>
          ) : null}
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
          {showDeleteConfirm ? (
            <View style={styles.deleteConfirmCard} testID="settings-delete-account-confirmation">
              <Text style={styles.deleteConfirmText}>{t('settingsDeleteTypePrompt')}</Text>
              <Text style={styles.deleteConfirmHint}>{t('settingsDeleteTypeHint')}</Text>
              <TextInput
                value={deleteConfirmInput}
                onChangeText={setDeleteConfirmInput}
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!isSubmitting}
                placeholder={t('settingsDeleteTypePlaceholder')}
                placeholderTextColor={theme.colors.textDisabled}
                style={styles.deleteConfirmInput}
                testID="settings-delete-account-input"
              />
              <View style={styles.deleteConfirmActions}>
                <Pressable
                  onPress={() => {
                    setShowDeleteConfirm(false);
                    setDeleteConfirmInput('');
                  }}
                  style={[styles.deleteCancelButton, isSubmitting ? styles.deleteButtonDisabled : null]}
                  disabled={isSubmitting}
                  testID="settings-delete-account-cancel"
                >
                  <Text style={styles.deleteCancelButtonLabel}>{t('cancel')}</Text>
                </Pressable>
                <Pressable
                  onPress={() => void doDeleteAccount()}
                  style={[
                    styles.deleteConfirmButton,
                    (!isDeleteConfirmValid || isSubmitting) ? styles.deleteButtonDisabled : null
                  ]}
                  disabled={!isDeleteConfirmValid || isSubmitting}
                  testID="settings-delete-account-confirm"
                >
                  <Text style={styles.deleteConfirmButtonLabel}>{t('settingsDeleteTypeCta')}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
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
  preferenceCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    gap: theme.spacing.sm
  },
  preferenceLabel: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '700'
  },
  preferenceHint: {
    color: theme.colors.textMuted,
    fontSize: 12
  },
  choiceRow: {
    flexDirection: 'row',
    gap: theme.spacing.xs
  },
  choiceChip: {
    flex: 1,
    minHeight: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xs
  },
  choiceChipActive: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surfaceButton
  },
  choiceChipLabel: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700'
  },
  choiceChipLabelActive: {
    color: theme.colors.textPrimary
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
  },
  deleteConfirmCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.error,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    gap: theme.spacing.sm
  },
  deleteConfirmText: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '700'
  },
  deleteConfirmHint: {
    color: theme.colors.textMuted,
    fontSize: 12
  },
  deleteConfirmInput: {
    minHeight: 42,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    backgroundColor: theme.colors.surfaceSunken,
    color: theme.colors.textPrimary,
    paddingHorizontal: theme.spacing.sm,
    fontSize: 14
  },
  deleteConfirmActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm
  },
  deleteCancelButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceSunken
  },
  deleteCancelButtonLabel: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    fontWeight: '700'
  },
  deleteConfirmButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.error,
    backgroundColor: theme.colors.error,
    alignItems: 'center',
    justifyContent: 'center'
  },
  deleteConfirmButtonLabel: {
    color: theme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '800'
  },
  deleteButtonDisabled: {
    opacity: 0.45
  }
});
