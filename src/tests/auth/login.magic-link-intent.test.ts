import { LOGIN_MAGIC_LINK_INTENT, requestLoginMagicLink } from '../../services/authMagicLinkUi';
import * as authService from '../../services/authService';

jest.mock('../../services/authService', () => ({
  requestMagicLink: jest.fn().mockResolvedValue(undefined)
}));

describe('login magic-link intent', () => {
  it('uses auto intent so first-time users can receive a signup-capable link', async () => {
    await requestLoginMagicLink('a@b.co');
    expect(authService.requestMagicLink).toHaveBeenCalledWith('a@b.co', LOGIN_MAGIC_LINK_INTENT);
    expect(LOGIN_MAGIC_LINK_INTENT).toBe('auto');
  });
});
