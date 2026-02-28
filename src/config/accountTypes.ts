export type AccountTypePermission =
  | 'admin:all'
  | 'chat:basic'
  | 'chat:unlimited'
  | 'artists:premium'
  | 'billing:manage';

export interface AccountTypeConfig {
  id: string;
  label: string;
  rank: number;
  permissions: AccountTypePermission[];
}

export const DEFAULT_ACCOUNT_TYPES: AccountTypeConfig[] = [
  {
    id: 'free',
    label: 'Free',
    rank: 0,
    permissions: ['chat:basic']
  },
  {
    id: 'regular',
    label: 'Regular',
    rank: 1,
    permissions: ['chat:basic', 'chat:unlimited']
  },
  {
    id: 'premium',
    label: 'Premium',
    rank: 2,
    permissions: ['chat:basic', 'chat:unlimited', 'artists:premium']
  },
  {
    id: 'admin',
    label: 'Admin',
    rank: 99,
    permissions: ['admin:all', 'billing:manage', 'chat:basic', 'chat:unlimited', 'artists:premium']
  },
  // Backward-compatible aliases for legacy rows.
  {
    id: 'core',
    label: 'Core (legacy)',
    rank: 1,
    permissions: ['chat:basic', 'chat:unlimited']
  },
  {
    id: 'pro',
    label: 'Pro (legacy)',
    rank: 2,
    permissions: ['chat:basic', 'chat:unlimited', 'artists:premium']
  }
];

export const accountTypesById = Object.fromEntries(
  DEFAULT_ACCOUNT_TYPES.map((type) => [type.id, type])
) as Record<string, AccountTypeConfig>;

export function getAccountTypeRank(id: string | null | undefined): number {
  if (!id) {
    return 0;
  }

  return accountTypesById[id]?.rank ?? 0;
}

export function hasPermission(accountTypeId: string | null | undefined, permission: AccountTypePermission): boolean {
  if (!accountTypeId) {
    return false;
  }

  const accountType = accountTypesById[accountTypeId];
  if (!accountType) {
    return false;
  }

  return accountType.permissions.includes('admin:all') || accountType.permissions.includes(permission);
}
