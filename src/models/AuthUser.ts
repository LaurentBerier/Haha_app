import type { AccountTypeId } from '../config/accountTypes';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: string | null;
  accountType: AccountTypeId | null;
  createdAt: string;
}

export type AuthSession =
  | {
      user: AuthUser;
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
    }
  | null;
