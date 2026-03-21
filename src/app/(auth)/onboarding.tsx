import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Animated, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  HOROSCOPE_OPTIONS,
  INTEREST_OPTIONS,
  RELATIONSHIP_OPTIONS,
  SEX_OPTIONS
} from '../../config/onboarding';
import type { HoroscopeSign, RelationshipStatus, Sex } from '../../models/UserProfile';
import { updatePreferredDisplayName } from '../../services/authService';
import { completeOnboarding, skipOnboarding } from '../../services/profileService';
import { t } from '../../i18n';
import { useStore } from '../../store/useStore';
import { theme } from '../../theme';

type OnboardingAnswers = {
  preferredName: string | null;
  age: number | null;
  sex: Sex | null;
  relationshipStatus: RelationshipStatus | null;
  horoscopeSign: HoroscopeSign | null;
  interests: string[];
};

const TOTAL_STEPS = 6;
const USE_NATIVE_DRIVER = Platform.OS !== 'web';

function normalizePreferredName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, 40);
}

export default function OnboardingScreen() {
  const userId = useStore((state) => state.session?.user.id ?? null);
  const userProfile = useStore((state) => state.userProfile);
  const setUserProfile = useStore((state) => state.setUserProfile);
  const setSession = useStore((state) => state.setSession);

  const [step, setStep] = useState(0);
  const optionPulse = useState(() => new Animated.Value(1))[0];
  const [preferredNameInput, setPreferredNameInput] = useState('');
  const [preferredNameError, setPreferredNameError] = useState<string | null>(null);
  const [ageInput, setAgeInput] = useState('');
  const [ageError, setAgeError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [answers, setAnswers] = useState<OnboardingAnswers>({
    preferredName: null,
    age: null,
    sex: null,
    relationshipStatus: null,
    horoscopeSign: null,
    interests: []
  });

  const progress = useMemo(() => `${Math.min(step + 1, TOTAL_STEPS)} / ${TOTAL_STEPS}`, [step]);

  useEffect(() => {
    if (!userProfile) {
      return;
    }

    if (userProfile.onboardingCompleted || userProfile.onboardingSkipped) {
      router.replace('/');
    }
  }, [userProfile]);

  const goNext = () => {
    if (isSubmitting) {
      return;
    }

    if (step < TOTAL_STEPS - 1) {
      setStep((value) => value + 1);
      return;
    }

    void finishOnboarding();
  };

  const skipCurrent = () => {
    if (isSubmitting) {
      return;
    }

    setErrorMessage(null);

    if (step === 0) {
      setAnswers((prev) => ({ ...prev, preferredName: null }));
      setPreferredNameInput('');
      setPreferredNameError(null);
    }
    if (step === 1) {
      setAnswers((prev) => ({ ...prev, age: null }));
      setAgeInput('');
      setAgeError(null);
    }
    if (step === 2) {
      setAnswers((prev) => ({ ...prev, sex: null }));
    }
    if (step === 3) {
      setAnswers((prev) => ({ ...prev, relationshipStatus: null }));
    }
    if (step === 4) {
      setAnswers((prev) => ({ ...prev, horoscopeSign: null }));
    }
    if (step === 5) {
      setAnswers((prev) => ({ ...prev, interests: [] }));
    }

    goNext();
  };

  const skipAll = async () => {
    if (isSubmitting) {
      return;
    }

    if (!userId) {
      router.replace('/(auth)/login');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const profile = await skipOnboarding(userId);
      if (!profile) {
        setErrorMessage("Impossible de sauvegarder ton choix pour l'instant. Réessaie.");
        return;
      }

      setUserProfile(profile);
      router.replace('/');
    } catch {
      setErrorMessage("Une erreur réseau est survenue. Vérifie ta connexion et réessaie.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const finishOnboarding = async () => {
    if (isSubmitting) {
      return;
    }

    if (!userId) {
      router.replace('/(auth)/login');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const preferredName = normalizePreferredName(preferredNameInput);
      const profile = await completeOnboarding(userId, {
        age: answers.age,
        sex: answers.sex,
        relationshipStatus: answers.relationshipStatus,
        horoscopeSign: answers.horoscopeSign,
        interests: answers.interests
      });

      if (!profile) {
        setErrorMessage("Impossible de sauvegarder ton profil pour l'instant. Réessaie.");
        return;
      }

      try {
        const refreshedSession = await updatePreferredDisplayName(preferredName);
        await setSession(refreshedSession);
      } catch (metadataError) {
        console.error('[Onboarding] preferred display name update failed', metadataError);
      }
      setUserProfile({ ...profile, preferredName });
      router.replace('/');
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : "Une erreur réseau est survenue. Vérifie ta connexion et réessaie.";
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
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
    const trimmed = ageInput.trim();
    if (!trimmed) {
      setAgeError(null);
      setAnswers((prev) => ({ ...prev, age: null }));
      goNext();
      return;
    }

    const parsedAge = Number.parseInt(ageInput, 10);
    if (Number.isFinite(parsedAge) && parsedAge >= 13 && parsedAge <= 120) {
      setAgeError(null);
      setAnswers((prev) => ({ ...prev, age: parsedAge }));
      goNext();
      return;
    }

    setAgeError(t('onboardingAgeInvalidRange'));
  };

  const onPreferredNameNext = () => {
    const normalized = normalizePreferredName(preferredNameInput);
    if (!normalized) {
      setPreferredNameError(null);
      setAnswers((prev) => ({ ...prev, preferredName: null }));
      goNext();
      return;
    }

    if (normalized.length < 2) {
      setPreferredNameError(t('onboardingPreferredNameTooShort'));
      return;
    }

    setPreferredNameError(null);
    setAnswers((prev) => ({ ...prev, preferredName: normalized }));
    setPreferredNameInput(normalized);
    goNext();
  };

  const animateOptionSelection = () => {
    Animated.sequence([
      Animated.spring(optionPulse, {
        toValue: 0.985,
        friction: 7,
        tension: 200,
        useNativeDriver: USE_NATIVE_DRIVER
      }),
      Animated.spring(optionPulse, {
        toValue: 1,
        friction: 7,
        tension: 200,
        useNativeDriver: USE_NATIVE_DRIVER
      })
    ]).start();
  };

  return (
    <ScrollView contentContainerStyle={styles.screen} testID="onboarding-screen">
      <Text style={styles.progress}>{progress}</Text>
      <View style={styles.progressBar}>
        {Array.from({ length: TOTAL_STEPS }).map((_, index) => {
          const isDone = index < step;
          const isActive = index === step;
          return (
            <View
              key={`progress-${index}`}
              style={[styles.progressSegment, isDone ? styles.progressSegmentDone : null, isActive ? styles.progressSegmentActive : null]}
            />
          );
        })}
      </View>
      <Text style={styles.title}>Personnalisation</Text>
      {step === 0 ? (
        <Text style={styles.privacy}>
          Ces questions nous permettent de personnaliser ton expérience avec Cathy. Tes réponses ne seront jamais partagées avec des tiers.
        </Text>
      ) : null}
      {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

      {step === 0 ? (
        <View style={styles.stepBlock}>
          <Text style={styles.question}>{t('onboardingPreferredNameQuestion')}</Text>
          <TextInput
            value={preferredNameInput}
            onChangeText={(value) => {
              setPreferredNameInput(value);
              if (preferredNameError) {
                setPreferredNameError(null);
              }
            }}
            placeholder={t('onboardingPreferredNamePlaceholder')}
            placeholderTextColor={theme.colors.textDisabled}
            style={styles.input}
            maxLength={40}
            autoCapitalize="words"
          />
          {preferredNameError ? <Text style={styles.errorText}>{preferredNameError}</Text> : null}
          <Pressable
            style={[styles.primaryButton, isSubmitting && styles.primaryButtonDisabled]}
            onPress={onPreferredNameNext}
            disabled={isSubmitting}
          >
            {isSubmitting ? <ActivityIndicator color={theme.colors.textPrimary} /> : <Text style={styles.primaryLabel}>Continuer</Text>}
          </Pressable>
        </View>
      ) : null}

      {step === 1 ? (
        <View style={styles.stepBlock}>
          <Text style={styles.question}>Quel est ton âge ?</Text>
          <TextInput
            value={ageInput}
            onChangeText={(value) => {
              setAgeInput(value);
              if (ageError) {
                setAgeError(null);
              }
            }}
            keyboardType="number-pad"
            placeholder="Ex: 28"
            placeholderTextColor={theme.colors.textDisabled}
            style={styles.input}
          />
          {ageError ? <Text style={styles.errorText}>{ageError}</Text> : null}
          <Pressable
            style={[styles.primaryButton, isSubmitting && styles.primaryButtonDisabled]}
            onPress={onAgeNext}
            disabled={isSubmitting}
          >
            {isSubmitting ? <ActivityIndicator color={theme.colors.textPrimary} /> : <Text style={styles.primaryLabel}>Continuer</Text>}
          </Pressable>
        </View>
      ) : null}

      {step === 2 ? (
        <View style={styles.stepBlock}>
          <Text style={styles.question}>Comment tu te identifies ?</Text>
          <Animated.View style={[styles.optionsWrap, { transform: [{ scale: optionPulse }] }]}>
            {SEX_OPTIONS.map((option) => (
              <Pressable
                key={option.value}
                style={[styles.optionButton, answers.sex === option.value && styles.optionButtonSelected]}
                onPress={() => {
                  if (isSubmitting) {
                    return;
                  }
                  animateOptionSelection();
                  setAnswers((prev) => ({ ...prev, sex: option.value }));
                  goNext();
                }}
                disabled={isSubmitting}
              >
                <Text style={styles.optionLabel}>{option.label}</Text>
              </Pressable>
            ))}
          </Animated.View>
        </View>
      ) : null}

      {step === 3 ? (
        <View style={styles.stepBlock}>
          <Text style={styles.question}>Ton statut amoureux ?</Text>
          <Animated.View style={[styles.optionsWrap, { transform: [{ scale: optionPulse }] }]}>
            {RELATIONSHIP_OPTIONS.map((option) => (
              <Pressable
                key={option.value}
                style={[
                  styles.optionButton,
                  answers.relationshipStatus === option.value && styles.optionButtonSelected
                ]}
                onPress={() => {
                  if (isSubmitting) {
                    return;
                  }
                  animateOptionSelection();
                  setAnswers((prev) => ({ ...prev, relationshipStatus: option.value }));
                  goNext();
                }}
                disabled={isSubmitting}
              >
                <Text style={styles.optionLabel}>{option.label}</Text>
              </Pressable>
            ))}
          </Animated.View>
        </View>
      ) : null}

      {step === 4 ? (
        <View style={styles.stepBlock}>
          <Text style={styles.question}>Ton signe astrologique ?</Text>
          <Animated.View style={[styles.gridWrap, { transform: [{ scale: optionPulse }] }]}>
            {HOROSCOPE_OPTIONS.map((option) => (
              <Pressable
                key={option.value}
                style={[
                  styles.gridButton,
                  answers.horoscopeSign === option.value && styles.optionButtonSelected
                ]}
                onPress={() => {
                  if (isSubmitting) {
                    return;
                  }
                  animateOptionSelection();
                  setAnswers((prev) => ({ ...prev, horoscopeSign: option.value }));
                  goNext();
                }}
                disabled={isSubmitting}
              >
                <Text style={styles.optionLabel}>{option.label}</Text>
              </Pressable>
            ))}
          </Animated.View>
        </View>
      ) : null}

      {step === 5 ? (
        <View style={styles.stepBlock}>
          <Text style={styles.question}>Tes centres d'intérêt ?</Text>
          <Animated.View style={[styles.optionsWrap, { transform: [{ scale: optionPulse }] }]}>
            {INTEREST_OPTIONS.map((interest) => (
              <Pressable
                key={interest}
                style={[
                  styles.optionButton,
                  answers.interests.includes(interest) && styles.optionButtonSelected
                ]}
                onPress={() => {
                  animateOptionSelection();
                  toggleInterest(interest);
                }}
                disabled={isSubmitting}
              >
                <Text style={styles.optionLabel}>{interest}</Text>
              </Pressable>
            ))}
          </Animated.View>

          <Pressable
            style={[styles.primaryButton, isSubmitting && styles.primaryButtonDisabled]}
            onPress={finishOnboarding}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color={theme.colors.textPrimary} />
            ) : (
              <Text style={styles.primaryLabel}>Tout est prêt ! Bienvenue chez Ha-Ha.</Text>
            )}
          </Pressable>
        </View>
      ) : null}

      <Pressable onPress={skipCurrent} disabled={isSubmitting}>
        <Text style={styles.secondaryLink}>Passer</Text>
      </Pressable>
      <Pressable onPress={() => void skipAll()} disabled={isSubmitting}>
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
  progressBar: {
    flexDirection: 'row',
    gap: theme.spacing.xs
  },
  progressSegment: {
    flex: 1,
    height: 6,
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceSunken,
    borderWidth: 1,
    borderColor: theme.colors.border
  },
  progressSegmentDone: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent
  },
  progressSegmentActive: {
    backgroundColor: theme.colors.surfaceButton,
    borderColor: theme.colors.surfaceButton
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
  errorText: {
    color: theme.colors.error,
    fontSize: 14
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
  primaryButtonDisabled: {
    opacity: 0.75
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
