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

  it('drops known web instrumentation noise in beforeSend', async () => {
    const initMock = jest.fn();
    const browserReplayIntegrationMock = jest.fn((_options?: unknown) => ({ name: 'Replay' }));

    jest.doMock('../config/env', () => ({
      SENTRY_DSN: 'https://public@example.ingest.sentry.io/1'
    }));
    jest.doMock('react-native', () => ({
      Platform: { OS: 'web' }
    }));
    jest.doMock('@sentry/react-native', () => ({
      init: initMock,
      withScope: jest.fn(),
      captureException: jest.fn(),
      browserReplayIntegration: browserReplayIntegrationMock
    }));

    const { initSentry } = await import('./sentry');
    expect(initSentry()).toBe(true);

    const sentryInitOptions = initMock.mock.calls[0]?.[0] as {
      beforeSend?: (event: unknown) => unknown | null;
      integrations?: (integrations: Array<{ name: string }>) => Array<{ name: string }>;
    };
    expect(typeof sentryInitOptions.beforeSend).toBe('function');
    expect(typeof sentryInitOptions.integrations).toBe('function');

    const resolveIntegrations = sentryInitOptions.integrations;
    if (!resolveIntegrations) {
      throw new Error('integrations should be configured');
    }

    const configuredIntegrations = resolveIntegrations([{ name: 'BrowserApiErrors' }, { name: 'GlobalHandlers' }]);
    expect(configuredIntegrations.find((integration) => integration.name === 'BrowserApiErrors')).toBeUndefined();
    expect(configuredIntegrations.find((integration) => integration.name === 'Replay')).toBeDefined();
    expect(browserReplayIntegrationMock).toHaveBeenCalledTimes(1);

    const replayCall = browserReplayIntegrationMock.mock.calls[0];
    const replayConfig = replayCall?.[0] as {
      beforeErrorSampling?: (event: unknown) => boolean;
    } | undefined;
    if (!replayConfig) {
      throw new Error('Replay config should be provided');
    }
    expect(typeof replayConfig.beforeErrorSampling).toBe('function');
    const beforeErrorSampling = replayConfig.beforeErrorSampling;
    if (!beforeErrorSampling) {
      throw new Error('beforeErrorSampling should be configured');
    }

    expect(beforeErrorSampling({
      exception: {
        values: [{ value: "Failed to execute 'selectNode' on 'Range': the given Node has no parent." }]
      }
    })).toBe(false);
    expect(beforeErrorSampling({
      exception: {
        values: [
          {
            value: "Cannot read properties of null (reading 'removeEventListener')",
            stacktrace: {
              frames: [{ filename: 'app:///instrument.d8551180a713e5397263.js' }]
            }
          }
        ]
      }
    })).toBe(false);
    expect(beforeErrorSampling({
      exception: {
        values: [{ value: 'TypeError: unrelated crash' }]
      }
    })).toBe(true);

    const beforeSend = sentryInitOptions.beforeSend;
    if (!beforeSend) {
      throw new Error('beforeSend should be configured');
    }

    const droppedSelectNodeEvent = beforeSend({
      exception: {
        values: [
          {
            value: "Failed to execute 'selectNode' on 'Range': the given Node has no parent."
          }
        ]
      }
    });
    expect(droppedSelectNodeEvent).toBeNull();

    const droppedRemoveListenerEvent = beforeSend({
      exception: {
        values: [
          {
            value: "Cannot read properties of null (reading 'removeEventListener')",
            stacktrace: {
              frames: [{ filename: 'app:///instrument.d8551180a713e5397263.js' }]
            }
          }
        ]
      }
    });
    expect(droppedRemoveListenerEvent).toBeNull();

    const keepGenericNullEvent = {
      exception: {
        values: [
          {
            value: "Cannot read properties of null (reading 'removeEventListener')",
            stacktrace: {
              frames: [{ filename: 'app:///entry-abc123.js' }]
            }
          }
        ]
      }
    };
    expect(beforeSend(keepGenericNullEvent)).toBe(keepGenericNullEvent);
  });
});
