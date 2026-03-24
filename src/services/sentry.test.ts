describe('sentry service', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  it('does not initialize when SENTRY_DSN is empty', async () => {
    const initMock = jest.fn();

    jest.doMock('../config/env', () => ({
      SENTRY_DSN: ''
    }));
    jest.doMock('react-native', () => ({
      Platform: { OS: 'ios' }
    }));
    jest.doMock('@sentry/react-native', () => ({
      init: initMock,
      withScope: jest.fn(),
      captureException: jest.fn()
    }));

    const { initSentry } = await import('./sentry');
    expect(initSentry()).toBe(false);
    expect(initMock).not.toHaveBeenCalled();
  });

  it('captures app exceptions with scope metadata', async () => {
    const initMock = jest.fn();
    const setTagMock = jest.fn();
    const setContextMock = jest.fn();
    const withScopeMock = jest.fn((callback: (scope: { setTag: (...args: string[]) => void; setContext: (...args: unknown[]) => void }) => void) => {
      callback({
        setTag: setTagMock,
        setContext: setContextMock
      });
    });
    const captureExceptionMock = jest.fn();

    jest.doMock('../config/env', () => ({
      SENTRY_DSN: 'https://public@example.ingest.sentry.io/1'
    }));
    jest.doMock('react-native', () => ({
      Platform: { OS: 'ios' }
    }));
    jest.doMock('@sentry/react-native', () => ({
      init: initMock,
      withScope: withScopeMock,
      captureException: captureExceptionMock
    }));

    const { captureAppException } = await import('./sentry');
    captureAppException(new Error('render exploded'), {
      scope: 'app/render',
      requestId: 'req-555',
      extra: { screen: 'home' }
    });

    expect(initMock).toHaveBeenCalledTimes(1);
    expect(withScopeMock).toHaveBeenCalledTimes(1);
    expect(setTagMock).toHaveBeenCalledWith('scope', 'app/render');
    expect(setTagMock).toHaveBeenCalledWith('request_id', 'req-555');
    expect(setContextMock).toHaveBeenCalledWith('extra', { screen: 'home' });
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });
});
