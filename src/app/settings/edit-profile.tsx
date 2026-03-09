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
import { updateProfile } from '../../services/profileService';
import { useStore } from '../../store/useStore';
import { theme } from '../../theme';

interface DraftProfile {
  age: string;
  sex: Sex | null;
  relationshipStatus: RelationshipStatus | null;
  horoscopeSign: HoroscopeSign | null;
  interests: string[];
}

function fromProfile(profile: UserProfile | null): DraftProfile {
  return {
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
  const [draft, setDraft] = useState<DraftProfile>(() => fromProfile(userProfile));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const hasChanges = useMemo(() => {
    if (!userProfile) {
      return true;
    }

    return (
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

      setUserProfile(updated);
      router.back();
    } catch {
      setErrorMessage('Une erreur réseau est survenue. Réessaie.');
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
              <Text style={styles.optionLabel}>{option.label}</Text>
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
              <Text style={styles.optionLabel}>{option.label}</Text>
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
              <Text style={styles.optionLabel}>{option.label}</Text>
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
              <Text style={styles.optionLabel}>{interest}</Text>
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
    borderColor: theme.colors.border,
    borderWidth: 1,
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
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm
  },
  gridButton: {
    width: '47%',
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm
  },
  optionButtonSelected: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surfaceRaised
  },
  optionLabel: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '600'
  },
  errorText: {
    color: theme.colors.error,
    fontSize: 14
  },
  primaryButton: {
    marginTop: theme.spacing.sm,
    backgroundColor: theme.colors.accent,
    borderRadius: 12,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md
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
