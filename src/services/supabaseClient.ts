import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config/env';

export const SUPABASE_CONFIG = {
  url: SUPABASE_URL,
  anonKey: SUPABASE_ANON_KEY
} as const;

const hasSupabaseConfig = Boolean(SUPABASE_URL.trim()) && Boolean(SUPABASE_ANON_KEY.trim());
const fallbackUrl = 'https://placeholder.supabase.co';
const fallbackAnonKey = 'placeholder-anon-key';

export function assertSupabaseConfigured(): void {
  if (hasSupabaseConfig) {
    return;
  }

  throw new Error(
    'Supabase is not configured. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to .env and restart Expo.'
  );
}

export const supabase = createClient(hasSupabaseConfig ? SUPABASE_URL : fallbackUrl, hasSupabaseConfig ? SUPABASE_ANON_KEY : fallbackAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false
  }
});
