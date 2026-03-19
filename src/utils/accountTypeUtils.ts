const VOICE_ENABLED_ACCOUNT_TYPES = new Set(['regular', 'premium', 'admin']);

export function normalizeAccountType(accountType: string | null | undefined): 'free' | 'regular' | 'premium' | 'admin' {
  if (typeof accountType === 'string' && accountType.trim()) {
    const normalized = accountType.trim().toLowerCase();
    if (normalized === 'free' || normalized === 'regular' || normalized === 'premium' || normalized === 'admin') {
      return normalized;
    }

    const compact = normalized.replace(/[\s_-]+/g, '');
    if (compact === 'unlimited') {
      return 'regular';
    }
    if (compact === 'proartist') {
      return 'premium';
    }
  }

  return 'free';
}

export function hasVoiceAccessForAccountType(accountType: string | null | undefined): boolean {
  return VOICE_ENABLED_ACCOUNT_TYPES.has(normalizeAccountType(accountType));
}
