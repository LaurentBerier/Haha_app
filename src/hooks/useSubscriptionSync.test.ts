import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useSubscriptionSync } from './useSubscriptionSync';

const mockFetchSubscriptionSummary = jest.fn();
const mockSyncSubscriptionState = jest.fn();
const mockFetchAccountType = jest.fn();
const mockUseStoreGetState = jest.fn();
const mockAddAppStateListener = jest.fn();

jest.mock('../i18n', () => ({
  t: (key: string) => key
}));

jest.mock('../services/subscriptionService', () => ({
  fetchSubscriptionSummary: (...args: unknown[]) => mockFetchSubscriptionSummary(...args),
  syncSubscriptionState: (...args: unknown[]) => mockSyncSubscriptionState(...args)
}));

jest.mock('../services/profileService', () => ({
  fetchAccountType: (...args: unknown[]) => mockFetchAccountType(...args)
}));

jest.mock('../store/useStore', () => {
  const useStore: { getState?: (...args: unknown[]) => unknown } = () => null;
  useStore.getState = (...args: unknown[]) => mockUseStoreGetState(...args);
  return { useStore };
});

jest.mock('react-native', () => ({
  AppState: {
    addEventListener: (...args: unknown[]) => mockAddAppStateListener(...args)
  },
  Platform: {
    OS: 'web'
  }
}));

interface HookHarnessProps {
  accessToken: string | null;
  userId: string | null;
  fallbackAccountType: string | null;
  toast: {
    info: jest.Mock<void, [string]>;
    success: jest.Mock<void, [string]>;
  };
}

let latestHookState: ReturnType<typeof useSubscriptionSync> | null = null;
const originalConsoleError = console.error;

function HookHarness(props: HookHarnessProps) {
  latestHookState = useSubscriptionSync(props);
  return null;
}

function getHookState(): ReturnType<typeof useSubscriptionSync> {
  if (!latestHookState) {
    throw new Error('Hook state unavailable');
  }
  return latestHookState;
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useSubscriptionSync', () => {
  const previousActEnv = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  let consoleErrorSpy: jest.SpyInstance;

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previousActEnv;
  });

  beforeEach(() => {
    jest.useFakeTimers();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      const firstArg = args[0];
      if (typeof firstArg === 'string' && firstArg.includes('react-test-renderer is deprecated')) {
        return;
      }
      originalConsoleError(...(args as Parameters<typeof console.error>));
    });
    latestHookState = null;
    mockFetchSubscriptionSummary.mockReset();
    mockSyncSubscriptionState.mockReset();
    mockFetchAccountType.mockReset();
    mockUseStoreGetState.mockReset();
    mockAddAppStateListener.mockReset();
    mockUseStoreGetState.mockReturnValue({
      session: {
        accessToken: 'token-1'
      }
    });
    mockAddAppStateListener.mockReturnValue({
      remove: jest.fn()
    });
    mockFetchAccountType.mockResolvedValue('free');
    mockFetchSubscriptionSummary.mockResolvedValue({
      accountType: 'free',
      provider: null,
      subscriptionStatus: null,
      nextBillingDate: null,
      cancelAtPeriodEnd: false,
      canCancel: false
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    consoleErrorSpy.mockRestore();
  });

  it('retries checkout sync with backoff until the expected plan is applied', async () => {
    const toast = {
      info: jest.fn<void, [string]>(),
      success: jest.fn<void, [string]>()
    };

    mockSyncSubscriptionState.mockResolvedValue(undefined);
    mockFetchSubscriptionSummary
      .mockResolvedValueOnce({
        accountType: 'free',
        provider: null,
        subscriptionStatus: null,
        nextBillingDate: null,
        cancelAtPeriodEnd: false,
        canCancel: false
      })
      .mockResolvedValueOnce({
        accountType: 'free',
        provider: null,
        subscriptionStatus: null,
        nextBillingDate: null,
        cancelAtPeriodEnd: false,
        canCancel: false
      })
      .mockResolvedValueOnce({
        accountType: 'regular',
        provider: 'stripe',
        subscriptionStatus: 'active',
        nextBillingDate: null,
        cancelAtPeriodEnd: false,
        canCancel: true
      });

    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(HookHarness, {
          accessToken: 'token-1',
          userId: 'user-1',
          fallbackAccountType: 'free',
          toast
        })
      );
    });
    await flushMicrotasks();

    await act(async () => {
      getHookState().startCheckoutSync('regular');
    });

    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    await flushMicrotasks();
    expect(mockSyncSubscriptionState).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    await flushMicrotasks();
    expect(mockSyncSubscriptionState).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledWith('settingsSubscriptionSyncSuccess');
    expect(toast.info).not.toHaveBeenCalled();

    await act(async () => {
      renderer!.unmount();
    });
  });

  it('stops pending checkout sync when clearPendingCheckoutSync is called', async () => {
    const toast = {
      info: jest.fn<void, [string]>(),
      success: jest.fn<void, [string]>()
    };

    mockSyncSubscriptionState.mockResolvedValue(undefined);

    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(HookHarness, {
          accessToken: 'token-1',
          userId: 'user-1',
          fallbackAccountType: 'free',
          toast
        })
      );
    });
    await flushMicrotasks();

    await act(async () => {
      const hook = getHookState();
      hook.startCheckoutSync('premium');
      hook.clearPendingCheckoutSync();
    });

    await act(async () => {
      jest.advanceTimersByTime(4500);
    });
    await flushMicrotasks();

    expect(mockSyncSubscriptionState).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();

    await act(async () => {
      renderer!.unmount();
    });
  });

  it('cleans up scheduled checkout sync timers on unmount', async () => {
    const toast = {
      info: jest.fn<void, [string]>(),
      success: jest.fn<void, [string]>()
    };
    const removeListener = jest.fn();
    mockAddAppStateListener.mockReturnValue({
      remove: removeListener
    });

    mockSyncSubscriptionState.mockResolvedValue(undefined);

    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(HookHarness, {
          accessToken: 'token-1',
          userId: 'user-1',
          fallbackAccountType: 'free',
          toast
        })
      );
    });
    await flushMicrotasks();

    await act(async () => {
      getHookState().startCheckoutSync('regular');
    });

    await act(async () => {
      renderer!.unmount();
    });

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    await flushMicrotasks();

    expect(mockSyncSubscriptionState).not.toHaveBeenCalled();
    expect(removeListener).toHaveBeenCalledTimes(1);
  });
});
