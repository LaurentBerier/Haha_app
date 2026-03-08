describe('subscriptionService', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('appends Stripe checkout identifiers when opening checkout', async () => {
    const canOpenURL = jest.fn().mockResolvedValue(true);
    const openURL = jest.fn().mockResolvedValue(undefined);

    jest.doMock('react-native', () => ({
      Linking: {
        canOpenURL,
        openURL
      }
    }));

    jest.doMock('../config/env', () => ({
      APPLE_PAY_CHECKOUT_URL: '',
      API_BASE_URL: 'https://api.ha-ha.ai',
      CLAUDE_PROXY_URL: '',
      PAYPAL_CHECKOUT_URL: '',
      STRIPE_CHECKOUT_URL_REGULAR: 'https://buy.stripe.com/regular',
      STRIPE_CHECKOUT_URL_PREMIUM: 'https://buy.stripe.com/premium'
    }));

    jest.doMock('./authService', () => ({
      refreshSession: jest.fn()
    }));

    jest.doMock('../store/useStore', () => ({
      useStore: {
        getState: () => ({
          setSession: jest.fn()
        })
      }
    }));

    const subscriptionService = (await import('./subscriptionService')) as typeof import('./subscriptionService');

    const opened = await subscriptionService.startSubscriptionCheckout('stripe', 'regular', {
      userId: 'user-123',
      email: 'user@example.com'
    });

    expect(opened).toBe(true);
    expect(canOpenURL).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenCalledTimes(1);

    const openedUrl = new URL(openURL.mock.calls[0][0]);
    expect(openedUrl.searchParams.get('client_reference_id')).toBe('user-123');
    expect(openedUrl.searchParams.get('prefilled_email')).toBe('user@example.com');
  });

  it('refreshes auth session and stores it during subscription sync', async () => {
    const refreshedSession = {
      accessToken: 'token',
      user: {
        id: 'user-1',
        email: 'user@example.com',
        accountType: 'regular'
      }
    };
    const refreshSession = jest.fn().mockResolvedValue(refreshedSession);
    const setSession = jest.fn().mockResolvedValue(undefined);

    jest.doMock('react-native', () => ({
      Linking: {
        canOpenURL: jest.fn().mockResolvedValue(true),
        openURL: jest.fn().mockResolvedValue(undefined)
      }
    }));

    jest.doMock('../config/env', () => ({
      APPLE_PAY_CHECKOUT_URL: '',
      API_BASE_URL: 'https://api.ha-ha.ai',
      CLAUDE_PROXY_URL: '',
      PAYPAL_CHECKOUT_URL: '',
      STRIPE_CHECKOUT_URL_REGULAR: '',
      STRIPE_CHECKOUT_URL_PREMIUM: ''
    }));

    jest.doMock('./authService', () => ({
      refreshSession
    }));

    jest.doMock('../store/useStore', () => ({
      useStore: {
        getState: () => ({
          setSession
        })
      }
    }));

    const subscriptionService = (await import('./subscriptionService')) as typeof import('./subscriptionService');
    await subscriptionService.syncSubscriptionState();

    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(setSession).toHaveBeenCalledWith(refreshedSession);
  });
});
