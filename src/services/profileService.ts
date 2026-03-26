import type { UserProfile } from '../models/UserProfile';
import { assertSupabaseConfigured, supabase } from './supabaseClient';

interface ProfileRow {
  id: string;
  age: number | null;
  sex: UserProfile['sex'];
  relationship_status: UserProfile['relationshipStatus'];
  horoscope_sign: UserProfile['horoscopeSign'];
  interests: string[] | null;
  memory_facts: string[] | null;
  onboarding_completed: boolean | null;
  onboarding_skipped: boolean | null;
}

const MAX_PERSISTED_MEMORY_FACTS = 30;

function normalizeMemoryFact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeMemoryFacts(facts: string[] | null | undefined): string[] {
  if (!Array.isArray(facts)) {
    return [];
  }

  const seen = new Set<string>();
  const normalizedFacts: string[] = [];
  for (const candidate of facts) {
    if (typeof candidate !== 'string') {
      continue;
    }

    const normalized = normalizeMemoryFact(candidate);
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalizedFacts.push(normalized);

    if (normalizedFacts.length >= MAX_PERSISTED_MEMORY_FACTS) {
      break;
    }
  }

  return normalizedFacts;
}

function toUserProfile(row: ProfileRow): UserProfile {
  return {
    id: row.id,
    preferredName: null,
    age: row.age,
    sex: row.sex,
    relationshipStatus: row.relationship_status,
    horoscopeSign: row.horoscope_sign,
    interests: Array.isArray(row.interests) ? row.interests : [],
    memoryFacts: normalizeMemoryFacts(row.memory_facts),
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
    memory_facts: partial.memoryFacts,
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
    'memory_facts',
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

export async function fetchAccountType(userId: string): Promise<string | null> {
  assertSupabaseConfigured();
  const { data, error } = await supabase
    .from('profiles')
    .select('account_type_id')
    .eq('id', userId)
    .maybeSingle<{ account_type_id: string | null }>();

  if (error) {
    throw error;
  }

  return data?.account_type_id ?? null;
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

export async function saveMemoryFacts(userId: string, facts: string[]): Promise<void> {
  assertSupabaseConfigured();
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    return;
  }

  const normalizedFacts = normalizeMemoryFacts(facts);
  const { error } = await supabase
    .from('profiles')
    .update({
      memory_facts: normalizedFacts
    })
    .eq('id', normalizedUserId);

  if (error) {
    throw error;
  }
}
