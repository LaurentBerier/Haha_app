import type { UserProfile } from '../models/UserProfile';
import { assertSupabaseConfigured, supabase } from './supabaseClient';

interface ProfileRow {
  id: string;
  age: number | null;
  sex: UserProfile['sex'];
  relationship_status: UserProfile['relationshipStatus'];
  horoscope_sign: UserProfile['horoscopeSign'];
  interests: string[] | null;
  onboarding_completed: boolean | null;
  onboarding_skipped: boolean | null;
}

function toUserProfile(row: ProfileRow): UserProfile {
  return {
    id: row.id,
    age: row.age,
    sex: row.sex,
    relationshipStatus: row.relationship_status,
    horoscopeSign: row.horoscope_sign,
    interests: Array.isArray(row.interests) ? row.interests : [],
    onboardingCompleted: row.onboarding_completed ?? false,
    onboardingSkipped: row.onboarding_skipped ?? false
  };
}

function toProfilePatch(partial: Partial<UserProfile>): Partial<ProfileRow> {
  const rawPatch: Partial<ProfileRow> = {
    age: partial.age,
    sex: partial.sex,
    relationship_status: partial.relationshipStatus,
    horoscope_sign: partial.horoscopeSign,
    interests: partial.interests,
    onboarding_completed: partial.onboardingCompleted,
    onboarding_skipped: partial.onboardingSkipped
  };

  return Object.fromEntries(
    Object.entries(rawPatch).filter(([, value]) => value !== undefined)
  ) as Partial<ProfileRow>;
}

function profileSelectColumns(): string {
  return [
    'id',
    'age',
    'sex',
    'relationship_status',
    'horoscope_sign',
    'interests',
    'onboarding_completed',
    'onboarding_skipped'
  ].join(', ');
}

export async function fetchProfile(userId: string): Promise<UserProfile | null> {
  assertSupabaseConfigured();
  const { data, error } = await supabase
    .from('profiles')
    .select(profileSelectColumns())
    .eq('id', userId)
    .maybeSingle<ProfileRow>();

  if (error) {
    throw error;
  }

  return data ? toUserProfile(data) : null;
}

export async function updateProfile(userId: string, partial: Partial<UserProfile>): Promise<UserProfile | null> {
  assertSupabaseConfigured();
  const patch = toProfilePatch(partial);
  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select(profileSelectColumns())
    .maybeSingle<ProfileRow>();

  if (error) {
    throw error;
  }

  return data ? toUserProfile(data) : null;
}

export async function completeOnboarding(
  userId: string,
  answers: Pick<
    UserProfile,
    'age' | 'sex' | 'relationshipStatus' | 'horoscopeSign' | 'interests'
  >
): Promise<UserProfile | null> {
  return updateProfile(userId, {
    ...answers,
    onboardingCompleted: true,
    onboardingSkipped: false
  });
}

export async function skipOnboarding(userId: string): Promise<UserProfile | null> {
  return updateProfile(userId, {
    onboardingCompleted: false,
    onboardingSkipped: true
  });
}
