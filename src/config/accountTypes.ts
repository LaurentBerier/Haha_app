export type AccountTypePermission =
  | 'admin:all'
  | 'chat:basic'
  | 'chat:unlimited'
  | 'artists:premium'
  | 'billing:manage';

export type KnownAccountTypeId = 'free' | 'regular' | 'premium' | 'admin';
export type AccountTypeId = KnownAccountTypeId | (string & {});

export interface AccountTypeConfig {
  id: AccountTypeId;
  label: string;
  rank: number;
  permissions: AccountTypePermission[];
  monthlyMessageCap: number | null;
}

export const DEFAULT_ACCOUNT_TYPES: AccountTypeConfig[] = [
  {
    id: 'free',
    label: 'Free',
    rank: 0,
    permissions: ['chat:basic'],
    monthlyMessageCap: 15
  },
  {
    id: 'regular',
    label: 'Regular',
    rank: 1,
    permissions: ['chat:basic', 'chat:unlimited'],
    monthlyMessageCap: 45
  },
  {
    id: 'premium',
    label: 'Premium',
    rank: 2,
    permissions: ['chat:basic', 'chat:unlimited', 'artists:premium'],
    monthlyMessageCap: 110
  },
  {
    id: 'admin',
    label: 'Admin',
    rank: 99,
    permissions: ['admin:all', 'billing:manage', 'chat:basic', 'chat:unlimited', 'artists:premium'],
    monthlyMessageCap: null
  }
];

export const accountTypesById = Object.fromEntries(
  DEFAULT_ACCOUNT_TYPES.map((type) => [type.id, type])
) as Record<string, AccountTypeConfig>;

export function getAccountTypeRank(id: AccountTypeId | null | undefined): number {
  if (!id) {
    return 0;
  }

  return accountTypesById[id]?.rank ?? 0;
}

export function hasPermission(accountTypeId: AccountTypeId | null | undefined, permission: AccountTypePermission): boolean {
  if (!accountTypeId) {
    return false;
  }

  const accountType = accountTypesById[accountTypeId];
  if (!accountType) {
    return false;
  }

  return accountType.permissions.includes('admin:all') || accountType.permissions.includes(permission);
}
