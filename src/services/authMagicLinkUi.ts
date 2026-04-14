import { requestMagicLink } from './authService';

/** Magic-link intent for the login screen: supports signup + sign-in in one flow. */
export const LOGIN_MAGIC_LINK_INTENT = 'auto' as const;

export async function requestLoginMagicLink(email: string): Promise<void> {
  return requestMagicLink(email.trim(), LOGIN_MAGIC_LINK_INTENT);
}
