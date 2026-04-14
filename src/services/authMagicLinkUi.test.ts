import { LOGIN_MAGIC_LINK_INTENT, requestLoginMagicLink } from './authMagicLinkUi';
import * as authService from './authService';

jest.mock('./authService', () => ({
  requestMagicLink: jest.fn().mockResolvedValue(undefined)
}));

describe('authMagicLinkUi', () => {
  it('uses the canonical auto intent for signup-capable magic links', async () => {
    await requestLoginMagicLink('  user@example.com  ');
    expect(authService.requestMagicLink).toHaveBeenCalledWith('user@example.com', LOGIN_MAGIC_LINK_INTENT);
    expect(LOGIN_MAGIC_LINK_INTENT).toBe('auto');
  });
});
