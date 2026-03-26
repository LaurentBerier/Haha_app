import type { AuthSession } from '../models/AuthUser';

function toNullableString(value: string | null | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

export function isSameSessionUser(left: AuthSession, right: AuthSession): boolean {
  if (!left || !right) {
    return false;
  }

  return left.user.id === right.user.id;
}

export function areAuthSessionsEquivalent(left: AuthSession, right: AuthSession): boolean {
  if (!left || !right) {
    return left === right;
  }

  return (
    left.user.id === right.user.id &&
    left.user.email === right.user.email &&
    toNullableString(left.user.displayName) === toNullableString(right.user.displayName) &&
    toNullableString(left.user.avatarUrl) === toNullableString(right.user.avatarUrl) &&
    toNullableString(left.user.role) === toNullableString(right.user.role) &&
    toNullableString(left.user.accountType) === toNullableString(right.user.accountType) &&
    left.user.createdAt === right.user.createdAt &&
    left.accessToken === right.accessToken &&
    left.refreshToken === right.refreshToken &&
    left.expiresAt === right.expiresAt
  );
}
