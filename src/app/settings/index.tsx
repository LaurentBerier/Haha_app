import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BackButton } from '../../components/common/BackButton';
import { useToast } from '../../components/common/ToastProvider';
import { SettingsRow } from '../../components/common/SettingsRow';
import { useHeaderHorizontalInset } from '../../hooks/useHeaderHorizontalInset';
import { useAuth } from '../../hooks/useAuth';
import { t } from '../../i18n';
import { resolveErrorMessage } from '../../config/errorMessages';
import { deleteAccount, signOut } from '../../services/authService';
import type { AppLanguage, ReduceMotionPreference } from '../../store/slices/uiSlice';
import { useStore } from '../../store/useStore';
import { theme } from '../../theme';
import { getAccountTypeLabel } from '../../utils/accountTypeUtils';

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
  const headerHorizontalInset = useHeaderHorizontalInset();
  const { isAdmin } = useAuth();
  const session = useStore((state) => state.session);
  const user = session?.user ?? null;
  const clearSession = useStore((state) => state.clearSession);
  const language = useStore((state) => state.language);
  const reduceMotion = useStore((state) => state.reduceMotion);
  const voiceAutoPlay = useStore((state) => state.voiceAutoPlay);
  const setLanguagePreference = useStore((state) => state.setLanguagePreference);
  const setReduceMotion = useStore((state) => state.setReduceMotion);
  const setVoiceAutoPlay = useStore((state) => state.setVoiceAutoPlay);
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
  const reduceMotionOptions: Array<{ value: ReduceMotionPreference; label: string }> = [
    { value: 'system', label: t('settingsReduceMotionSystem') },
    { value: 'off', label: t('settingsReduceMotionOff') },
    { value: 'on', label: t('settingsReduceMotionOn') }
  ];
  const voiceAutoPlayOptions: Array<{ value: boolean; label: string }> = [
    { value: false, label: t('settingsVoiceAutoPlayOff') },
    { value: true, label: t('settingsVoiceAutoPlayOn') }
  ];

  const doLogout = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await signOut();
      clearSession();
      router.replace('/(auth)/login');
    } catch (error) {
      const message = resolveErrorMessage(error, 'generic');
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
      setErrorMessage(resolveErrorMessage(null, 'generic'));
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      await deleteAccount(session.accessToken);
      clearSession();
      router.replace('/(auth)/login');
    } catch (error) {
      const message = resolveErrorMessage(error, 'deleteAccount');
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
    <View style={styles.root}>
      <View style={[styles.topRow, { paddingHorizontal: headerHorizontalInset }]}>
        <BackButton testID="settings-back" />
      </View>
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
          <Text style={styles.preferenceLabel}>{t('settingsReduceMotion')}</Text>
          <View style={styles.choiceRow}>
            {reduceMotionOptions.map((option) => (
              <Pressable
                key={option.value}
                onPress={() => setReduceMotion(option.value)}
                style={[styles.choiceChip, reduceMotion === option.value ? styles.choiceChipActive : null]}
                testID={`settings-reduce-motion-${option.value}`}
              >
                <Text style={[styles.choiceChipLabel, reduceMotion === option.value ? styles.choiceChipLabelActive : null]}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.preferenceCard}>
          <Text style={styles.preferenceLabel}>{t('settingsVoiceAutoPlay')}</Text>
          <Text style={styles.preferenceHint}>{t('settingsVoiceAutoPlayHint')}</Text>
          <View style={styles.choiceRow}>
            {voiceAutoPlayOptions.map((option) => (
              <Pressable
                key={option.label}
                onPress={() => setVoiceAutoPlay(option.value)}
                style={[styles.choiceChip, voiceAutoPlay === option.value ? styles.choiceChipActive : null]}
                testID={`settings-voice-autoplay-${option.value ? 'on' : 'off'}`}
              >
                <Text
                  style={[styles.choiceChipLabel, voiceAutoPlay === option.value ? styles.choiceChipLabelActive : null]}
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
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

      {isAdmin ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Administration</Text>
          <View style={styles.group}>
            <SettingsRow
              label="Admin Dashboard"
              onPress={() => router.push('/admin' as never)}
              testID="settings-admin-dashboard"
            />
          </View>
        </View>
      ) : null}

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
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.colors.background
  },
  screen: {
    width: '100%',
    maxWidth: 656,
    alignSelf: 'center',
    padding: theme.spacing.lg,
    gap: theme.spacing.lg,
    backgroundColor: theme.colors.background,
    minHeight: '100%'
  },
  topRow: {
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.xs
  },
  profileCard: {
    borderWidth: 1.6,
    borderColor: theme.colors.neonRedSoft,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.lg,
    alignItems: 'center',
    gap: theme.spacing.sm,
    shadowColor: theme.colors.neonRed,
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4
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
    borderWidth: 1.45,
    borderColor: theme.colors.neonBlueSoft,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
    shadowColor: theme.colors.neonBlue,
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3
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
    borderColor: theme.colors.neonRed,
    backgroundColor: theme.colors.surfaceButton,
    shadowColor: theme.colors.neonRed,
    shadowOpacity: 0.42,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 5
  },
  choiceChipLabel: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700'
  },
  choiceChipLabelActive: {
    color: theme.colors.neonRed
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
    borderWidth: 1.6,
    borderColor: theme.colors.error,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
    shadowColor: theme.colors.error,
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4
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
