import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  HOROSCOPE_OPTIONS,
  INTEREST_OPTIONS,
  RELATIONSHIP_OPTIONS,
  SEX_OPTIONS
} from '../../config/onboarding';
import type { HoroscopeSign, RelationshipStatus, Sex } from '../../models/UserProfile';
import { completeOnboarding, skipOnboarding } from '../../services/profileService';
import { useStore } from '../../store/useStore';
import { theme } from '../../theme';

type OnboardingAnswers = {
  age: number | null;
  sex: Sex | null;
  relationshipStatus: RelationshipStatus | null;
  horoscopeSign: HoroscopeSign | null;
  interests: string[];
};

const TOTAL_STEPS = 5;

export default function OnboardingScreen() {
  const userId = useStore((state) => state.session?.user.id ?? null);
  const setUserProfile = useStore((state) => state.setUserProfile);

  const [step, setStep] = useState(0);
  const [ageInput, setAgeInput] = useState('');
  const [answers, setAnswers] = useState<OnboardingAnswers>({
    age: null,
    sex: null,
    relationshipStatus: null,
    horoscopeSign: null,
    interests: []
  });

  const progress = useMemo(() => `${Math.min(step + 1, TOTAL_STEPS)} / ${TOTAL_STEPS}`, [step]);

  const goNext = () => {
    if (step < TOTAL_STEPS - 1) {
      setStep((value) => value + 1);
      return;
    }

    void finishOnboarding();
  };

  const skipCurrent = () => {
    if (step === 0) {
      setAnswers((prev) => ({ ...prev, age: null }));
      setAgeInput('');
    }
    if (step === 1) {
      setAnswers((prev) => ({ ...prev, sex: null }));
    }
    if (step === 2) {
      setAnswers((prev) => ({ ...prev, relationshipStatus: null }));
    }
    if (step === 3) {
      setAnswers((prev) => ({ ...prev, horoscopeSign: null }));
    }
    if (step === 4) {
      setAnswers((prev) => ({ ...prev, interests: [] }));
    }

    goNext();
  };

  const skipAll = async () => {
    if (!userId) {
      router.replace('/(auth)/login');
      return;
    }

    const profile = await skipOnboarding(userId);
    if (profile) {
      setUserProfile(profile);
    }
    router.replace('/');
  };

  const finishOnboarding = async () => {
    if (!userId) {
      router.replace('/(auth)/login');
      return;
    }

    const profile = await completeOnboarding(userId, {
      age: answers.age,
      sex: answers.sex,
      relationshipStatus: answers.relationshipStatus,
      horoscopeSign: answers.horoscopeSign,
      interests: answers.interests
    });

    if (profile) {
      setUserProfile(profile);
    }

    router.replace('/');
  };

  const toggleInterest = (interest: string) => {
    setAnswers((prev) => ({
      ...prev,
      interests: prev.interests.includes(interest)
        ? prev.interests.filter((value) => value !== interest)
        : [...prev.interests, interest]
    }));
  };

  const onAgeNext = () => {
    const parsedAge = Number.parseInt(ageInput, 10);
    if (Number.isFinite(parsedAge) && parsedAge >= 13 && parsedAge <= 120) {
      setAnswers((prev) => ({ ...prev, age: parsedAge }));
    } else {
      setAnswers((prev) => ({ ...prev, age: null }));
    }
    goNext();
  };

  return (
    <ScrollView contentContainerStyle={styles.screen} testID="onboarding-screen">
      <Text style={styles.progress}>{progress}</Text>
      <Text style={styles.title}>Personnalisation</Text>
      <Text style={styles.privacy}>
        Ces questions nous permettent de personnaliser ton expérience avec Cathy. Tes réponses ne seront jamais partagées avec des tiers.
      </Text>

      {step === 0 ? (
        <View style={styles.stepBlock}>
          <Text style={styles.question}>Quel est ton âge ?</Text>
          <TextInput
            value={ageInput}
            onChangeText={setAgeInput}
            keyboardType="number-pad"
            placeholder="Ex: 28"
            placeholderTextColor={theme.colors.textDisabled}
            style={styles.input}
          />
          <Pressable style={styles.primaryButton} onPress={onAgeNext}>
            <Text style={styles.primaryLabel}>Continuer</Text>
          </Pressable>
        </View>
      ) : null}

      {step === 1 ? (
        <View style={styles.stepBlock}>
          <Text style={styles.question}>Comment tu te identifies ?</Text>
          <View style={styles.optionsWrap}>
            {SEX_OPTIONS.map((option) => (
              <Pressable
                key={option.value}
                style={[styles.optionButton, answers.sex === option.value && styles.optionButtonSelected]}
                onPress={() => {
                  setAnswers((prev) => ({ ...prev, sex: option.value }));
                  goNext();
                }}
              >
                <Text style={styles.optionLabel}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {step === 2 ? (
        <View style={styles.stepBlock}>
          <Text style={styles.question}>Ton statut amoureux ?</Text>
          <View style={styles.optionsWrap}>
            {RELATIONSHIP_OPTIONS.map((option) => (
              <Pressable
                key={option.value}
                style={[
                  styles.optionButton,
                  answers.relationshipStatus === option.value && styles.optionButtonSelected
                ]}
                onPress={() => {
                  setAnswers((prev) => ({ ...prev, relationshipStatus: option.value }));
                  goNext();
                }}
              >
                <Text style={styles.optionLabel}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {step === 3 ? (
        <View style={styles.stepBlock}>
          <Text style={styles.question}>Ton signe astrologique ?</Text>
          <View style={styles.gridWrap}>
            {HOROSCOPE_OPTIONS.map((option) => (
              <Pressable
                key={option.value}
                style={[
                  styles.gridButton,
                  answers.horoscopeSign === option.value && styles.optionButtonSelected
                ]}
                onPress={() => {
                  setAnswers((prev) => ({ ...prev, horoscopeSign: option.value }));
                  goNext();
                }}
              >
                <Text style={styles.optionLabel}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {step === 4 ? (
        <View style={styles.stepBlock}>
          <Text style={styles.question}>Tes centres d'intérêt ?</Text>
          <View style={styles.optionsWrap}>
            {INTEREST_OPTIONS.map((interest) => (
              <Pressable
                key={interest}
                style={[
                  styles.optionButton,
                  answers.interests.includes(interest) && styles.optionButtonSelected
                ]}
                onPress={() => toggleInterest(interest)}
              >
                <Text style={styles.optionLabel}>{interest}</Text>
              </Pressable>
            ))}
          </View>

          <Pressable style={styles.primaryButton} onPress={finishOnboarding}>
            <Text style={styles.primaryLabel}>Tout est prêt ! Bienvenue chez Ha-Ha.</Text>
          </Pressable>
        </View>
      ) : null}

      <Pressable onPress={skipCurrent}>
        <Text style={styles.secondaryLink}>Passer</Text>
      </Pressable>
      <Pressable onPress={() => void skipAll()}>
        <Text style={styles.secondaryLink}>Passer toutes les questions</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    paddingVertical: theme.spacing.xl,
    paddingHorizontal: theme.spacing.lg,
    backgroundColor: theme.colors.background,
    minHeight: '100%',
    gap: theme.spacing.md
  },
  progress: {
    color: theme.colors.textMuted,
    fontSize: 13,
    textAlign: 'right'
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: 28,
    fontWeight: '700'
  },
  privacy: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    lineHeight: 20
  },
  stepBlock: {
    marginTop: theme.spacing.md,
    gap: theme.spacing.md
  },
  question: {
    color: theme.colors.textPrimary,
    fontSize: 20,
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
  primaryButton: {
    marginTop: theme.spacing.sm,
    backgroundColor: theme.colors.accent,
    borderRadius: 12,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md
  },
  primaryLabel: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center'
  },
  secondaryLink: {
    textAlign: 'center',
    color: theme.colors.textSecondary,
    fontWeight: '600'
  }
});
