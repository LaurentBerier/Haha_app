/**
 * @jest-environment node
 */
import { isIosMobileWebRuntime, isIosMobileWebUserAgent, shouldTryAuthNativeHandoff } from './platformCapabilities';

jest.mock('react-native', () => ({
  Platform: { OS: 'web' }
}));

describe('platformCapabilities', () => {
  const originalWindow = global.window;
  const originalNavigator = global.navigator;

  afterEach(() => {
    global.window = originalWindow;
    global.navigator = originalNavigator;
 });

  it('shouldTryAuthNativeHandoff is false on desktop UA', () => {
    global.window = {} as Window & typeof globalThis;
    global.navigator = { userAgent: 'Mozilla/5.0 Macintosh' } as Navigator;

    const url = new URL('https://app.example/auth/callback?access_token=a&refresh_token=b');
    expect(
      shouldTryAuthNativeHandoff(url, {
        hasAuthPayload: () => true,
        sessionStorageGetItem: () => null
      })
    ).toBe(false);
  });

  it('shouldTryAuthNativeHandoff is true on mobile web when payload present and not already handed off', () => {
    global.window = {} as Window & typeof globalThis;
    global.navigator = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' } as Navigator;

    const url = new URL('https://app.example/auth/callback?access_token=a&refresh_token=b');
    expect(
      shouldTryAuthNativeHandoff(url, {
        hasAuthPayload: () => true,
        sessionStorageGetItem: () => null
      })
    ).toBe(true);
  });

  it('shouldTryAuthNativeHandoff is false when opened_in_app=1', () => {
    global.window = {} as Window & typeof globalThis;
    global.navigator = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' } as Navigator;

    const url = new URL('https://app.example/auth/callback?access_token=a&refresh_token=b&opened_in_app=1');
    expect(
      shouldTryAuthNativeHandoff(url, {
        hasAuthPayload: () => true,
        sessionStorageGetItem: () => null
      })
    ).toBe(false);
  });

  it('isIosMobileWebUserAgent detects iPhone/iPad and iPadOS desktop-class UA', () => {
    expect(isIosMobileWebUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(true);
    expect(isIosMobileWebUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe(true);
    expect(
      isIosMobileWebUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      )
    ).toBe(true);
  });

  it('isIosMobileWebUserAgent returns false for Android and desktop', () => {
    expect(isIosMobileWebUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe(false);
    expect(isIosMobileWebUserAgent('Mozilla/5.0 Macintosh')).toBe(false);
  });

  it('isIosMobileWebRuntime follows web + navigator user agent detection', () => {
    global.window = {} as Window & typeof globalThis;
    global.navigator = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' } as Navigator;
    expect(isIosMobileWebRuntime()).toBe(true);

    global.navigator = { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)' } as Navigator;
    expect(isIosMobileWebRuntime()).toBe(false);
  });
});
