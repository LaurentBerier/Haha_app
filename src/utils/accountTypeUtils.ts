import { t } from '../i18n';

const VOICE_ENABLED_ACCOUNT_TYPES = new Set(['free', 'regular', 'premium', 'admin']);

export function normalizeAccountType(accountType: string | null | undefined): 'free' | 'regular' | 'premium' | 'admin' {
  if (typeof accountType === 'string' && accountType.trim()) {
    const normalized = accountType.trim().toLowerCase();
    if (normalized === 'free' || normalized === 'regular' || normalized === 'premium' || normalized === 'admin') {
      return normalized;
    }
  }

  return 'free';
}

export function isAdminRole(role: string | null | undefined): boolean {
  return typeof role === 'string' && role.trim().toLowerCase() === 'admin';
}

export function resolveEffectiveAccountType(
  accountType: string | null | undefined,
  role: string | null | undefined
): 'free' | 'regular' | 'premium' | 'admin' {
  if (isAdminRole(role)) {
    return 'admin';
  }

  return normalizeAccountType(accountType);
}

export function hasVoiceAccessForAccountType(accountType: string | null | undefined): boolean {
  return VOICE_ENABLED_ACCOUNT_TYPES.has(normalizeAccountType(accountType));
}

export function getAccountTypeLabel(accountType: string | null | undefined): string {
  const normalized = normalizeAccountType(accountType);
  if (normalized === 'regular') {
    return t('accountTypeRegular');
  }
  if (normalized === 'premium') {
    return t('accountTypePremium');
  }
  if (normalized === 'admin') {
    return t('accountTypeAdmin');
  }
  return t('accountTypeFree');
}
