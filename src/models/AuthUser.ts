export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: string | null;
  accountType: string | null;
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
