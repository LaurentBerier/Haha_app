import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BackButton } from '../../components/common/BackButton';
import {
  HOROSCOPE_OPTIONS,
  INTEREST_OPTIONS,
  RELATIONSHIP_OPTIONS,
  SEX_OPTIONS
} from '../../config/onboarding';
import type { HoroscopeSign, RelationshipStatus, Sex, UserProfile } from '../../models/UserProfile';
import { updatePreferredDisplayName } from '../../services/authService';
import { updateProfile } from '../../services/profileService';
import { useStore } from '../../store/useStore';
import { theme } from '../../theme';

interface DraftProfile {
  preferredName: string;
  age: string;
  sex: Sex | null;
  relationshipStatus: RelationshipStatus | null;
  horoscopeSign: HoroscopeSign | null;
  interests: string[];
}

function normalizePreferredName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, 40);
}

function fromProfile(profile: UserProfile | null): DraftProfile {
  return {
    preferredName: profile?.preferredName ?? '',
    age: typeof profile?.age === 'number' ? String(profile.age) : '',
    sex: profile?.sex ?? null,
    relationshipStatus: profile?.relationshipStatus ?? null,
    horoscopeSign: profile?.horoscopeSign ?? null,
    interests: profile?.interests ?? []
  };
}

export default function EditProfileScreen() {
  const userId = useStore((state) => state.session?.user.id ?? null);
  const userProfile = useStore((state) => state.userProfile);
  const setUserProfile = useStore((state) => state.setUserProfile);
  const setSession = useStore((state) => state.setSession);
  const [draft, setDraft] = useState<DraftProfile>(() => fromProfile(userProfile));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const hasChanges = useMemo(() => {
    if (!userProfile) {
      return true;
    }

    return (
      draft.preferredName.trim() !== (userProfile.preferredName ?? '') ||
      draft.age !== (userProfile.age === null ? '' : String(userProfile.age)) ||
      draft.sex !== userProfile.sex ||
      draft.relationshipStatus !== userProfile.relationshipStatus ||
      draft.horoscopeSign !== userProfile.horoscopeSign ||
      draft.interests.join('|') !== userProfile.interests.join('|')
    );
  }, [draft, userProfile]);

  const toggleInterest = (interest: string) => {
    setDraft((prev) => ({
      ...prev,
      interests: prev.interests.includes(interest)
        ? prev.interests.filter((value) => value !== interest)
        : [...prev.interests, interest]
    }));
  };

  const save = async () => {
    if (isSubmitting || !userId) {
      return;
    }

    const preferredName = normalizePreferredName(draft.preferredName);
    const ageValue = Number.parseInt(draft.age, 10);
    const age = Number.isFinite(ageValue) && ageValue >= 13 && ageValue <= 120 ? ageValue : null;

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const updated = await updateProfile(userId, {
        age,
        sex: draft.sex,
        relationshipStatus: draft.relationshipStatus,
        horoscopeSign: draft.horoscopeSign,
        interests: draft.interests
      });

      if (!updated) {
        setErrorMessage("Impossible d'enregistrer ton profil pour le moment.");
        return;
      }

      try {
        const refreshedSession = await updatePreferredDisplayName(preferredName);
        await setSession(refreshedSession);
      } catch (metadataError) {
        console.error('[EditProfile] preferred display name update failed', metadataError);
      }
      setUserProfile({ ...updated, preferredName });
      router.back();
    } catch (error) {
      const message = error instanceof Error && error.message.trim() ? error.message.trim() : 'Une erreur réseau est survenue. Réessaie.';
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.screen} testID="settings-edit-profile-screen">
      <View style={styles.topRow}>
        <BackButton testID="settings-edit-profile-back" />
      </View>
      <Text style={styles.title}>Modifier mon profil</Text>

      <View style={styles.group}>
        <Text style={styles.label}>Comment Cathy doit t'appeler ?</Text>
        <TextInput
          value={draft.preferredName}
          onChangeText={(value) => setDraft((prev) => ({ ...prev, preferredName: value }))}
          placeholder="Ex: Laurent"
          placeholderTextColor={theme.colors.textDisabled}
          style={styles.input}
          maxLength={40}
          autoCapitalize="words"
        />
      </View>

      <View style={styles.group}>
        <Text style={styles.label}>Quel est ton âge ?</Text>
        <TextInput
          value={draft.age}
          onChangeText={(value) => setDraft((prev) => ({ ...prev, age: value }))}
          keyboardType="number-pad"
          placeholder="Ex: 28"
          placeholderTextColor={theme.colors.textDisabled}
          style={styles.input}
        />
      </View>

      <View style={styles.group}>
        <Text style={styles.label}>Comment tu te identifies ?</Text>
        <View style={styles.optionsWrap}>
          {SEX_OPTIONS.map((option) => (
            <Pressable
              key={option.value}
              style={[styles.optionButton, draft.sex === option.value && styles.optionButtonSelected]}
              onPress={() => setDraft((prev) => ({ ...prev, sex: option.value }))}
              disabled={isSubmitting}
            >
              <Text style={[styles.optionLabel, draft.sex === option.value && styles.optionLabelSelected]}>{option.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.group}>
        <Text style={styles.label}>Ton statut amoureux ?</Text>
        <View style={styles.optionsWrap}>
          {RELATIONSHIP_OPTIONS.map((option) => (
            <Pressable
              key={option.value}
              style={[
                styles.optionButton,
                draft.relationshipStatus === option.value && styles.optionButtonSelected
              ]}
              onPress={() => setDraft((prev) => ({ ...prev, relationshipStatus: option.value }))}
              disabled={isSubmitting}
            >
              <Text
                style={[
                  styles.optionLabel,
                  draft.relationshipStatus === option.value && styles.optionLabelSelected
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.group}>
        <Text style={styles.label}>Ton signe astrologique ?</Text>
        <View style={styles.gridWrap}>
          {HOROSCOPE_OPTIONS.map((option) => (
            <Pressable
              key={option.value}
              style={[styles.gridButton, draft.horoscopeSign === option.value && styles.optionButtonSelected]}
              onPress={() => setDraft((prev) => ({ ...prev, horoscopeSign: option.value }))}
              disabled={isSubmitting}
            >
              <Text style={[styles.optionLabel, draft.horoscopeSign === option.value && styles.optionLabelSelected]}>
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.group}>
        <Text style={styles.label}>Tes centres d'intérêt ?</Text>
        <View style={styles.optionsWrap}>
          {INTEREST_OPTIONS.map((interest) => (
            <Pressable
              key={interest}
              style={[styles.optionButton, draft.interests.includes(interest) && styles.optionButtonSelected]}
              onPress={() => toggleInterest(interest)}
              disabled={isSubmitting}
            >
              <Text style={[styles.optionLabel, draft.interests.includes(interest) && styles.optionLabelSelected]}>
                {interest}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

      <Pressable
        style={[styles.primaryButton, (!hasChanges || isSubmitting) && styles.primaryButtonDisabled]}
        onPress={() => void save()}
        disabled={!hasChanges || isSubmitting}
      >
        <Text style={styles.primaryLabel}>{isSubmitting ? 'Enregistrement...' : 'Enregistrer'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    minHeight: '100%',
    width: '100%',
    maxWidth: 656,
    alignSelf: 'center',
    backgroundColor: theme.colors.background,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.xl,
    gap: theme.spacing.md
  },
  topRow: {
    alignSelf: 'flex-start'
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: 28,
    fontWeight: '700'
  },
  group: {
    gap: theme.spacing.sm
  },
  label: {
    color: theme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '700'
  },
  input: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.neonBlueSoft,
    borderWidth: 1.3,
    borderRadius: 12,
    color: theme.colors.textPrimary,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    fontSize: 16
  },
  optionsWrap: {
    gap: theme.spacing.sm
  },
  gridWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm
  },
  optionButton: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.neonBlueSoft,
    borderWidth: 1.3,
    borderRadius: 12,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm
  },
  gridButton: {
    width: '47%',
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.neonBlueSoft,
    borderWidth: 1.3,
    borderRadius: 12,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm
  },
  optionButtonSelected: {
    borderColor: theme.colors.neonRed,
    backgroundColor: theme.colors.surfaceRaised,
    shadowColor: theme.colors.neonRed,
    shadowOpacity: 0.42,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 5
  },
  optionLabel: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '600'
  },
  optionLabelSelected: {
    color: theme.colors.neonRed,
    fontWeight: '700'
  },
  errorText: {
    color: theme.colors.error,
    fontSize: 14
  },
  primaryButton: {
    marginTop: theme.spacing.sm,
    width: '100%',
    maxWidth: 256,
    alignSelf: 'center',
    backgroundColor: theme.colors.accent,
    borderWidth: 1.7,
    borderColor: theme.colors.neonBlue,
    borderRadius: 12,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
    shadowColor: theme.colors.neonBlue,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6
  },
  primaryButtonDisabled: {
    opacity: 0.7
  },
  primaryLabel: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '700'
  }
});
