function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (typeof value === 'string') {
      process.env[key] = value;
    } else {
      delete process.env[key];
    }
  }
}

describe('api/_sentry', () => {
  const originalEnv = {
    SENTRY_DSN: process.env.SENTRY_DSN
  };

  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    restoreEnv(originalEnv);
  });

  it('returns false when no DSN is configured', () => {
    delete process.env.SENTRY_DSN;

    const initMock = jest.fn();
    jest.doMock('@sentry/node', () => ({
      init: initMock,
      withScope: jest.fn(),
      captureException: jest.fn()
    }));

    const { initApiSentry, captureApiException } = require('../_sentry');
    const initialized = initApiSentry();
    captureApiException(new Error('boom'));

    expect(initialized).toBe(false);
    expect(initMock).not.toHaveBeenCalled();
  });

  it('captures exception with request context when DSN is configured', () => {
    process.env.SENTRY_DSN = 'https://public@example.ingest.sentry.io/1';

    const initMock = jest.fn();
    const setTagMock = jest.fn();
    const setContextMock = jest.fn();
    const withScopeMock = jest.fn((callback) => {
      callback({
        setTag: setTagMock,
        setContext: setContextMock
      });
    });
    const captureExceptionMock = jest.fn();

    jest.doMock('@sentry/node', () => ({
      init: initMock,
      withScope: withScopeMock,
      captureException: captureExceptionMock
    }));

    const { captureApiException } = require('../_sentry');

    captureApiException(new Error('fatal test error'), {
      requestId: 'req-123',
      scope: 'api/unit-test',
      extra: { endpoint: '/api/test' }
    });

    expect(initMock).toHaveBeenCalledTimes(1);
    expect(withScopeMock).toHaveBeenCalledTimes(1);
    expect(setTagMock).toHaveBeenCalledWith('request_id', 'req-123');
    expect(setTagMock).toHaveBeenCalledWith('scope', 'api/unit-test');
    expect(setContextMock).toHaveBeenCalledWith('extra', { endpoint: '/api/test' });
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });
});
