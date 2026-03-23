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
    SENTRY_DSN: process.env.SENTRY_DSN,
    SENTRY_DSN_API: process.env.SENTRY_DSN_API,
    SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT,
    SENTRY_RELEASE: process.env.SENTRY_RELEASE,
    SENTRY_TRACES_SAMPLE_RATE: process.env.SENTRY_TRACES_SAMPLE_RATE
  };

  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    restoreEnv(originalEnv);
  });

  it('returns false when no DSN is configured', () => {
    delete process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN_API;

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
    process.env.SENTRY_ENVIRONMENT = 'test';
    process.env.SENTRY_RELEASE = 'unit-test-release';
    process.env.SENTRY_TRACES_SAMPLE_RATE = '0.25';

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

  it('prefers SENTRY_DSN_API over SENTRY_DSN when both are present', () => {
    process.env.SENTRY_DSN = 'https://default@example.ingest.sentry.io/2';
    process.env.SENTRY_DSN_API = 'https://api@example.ingest.sentry.io/3';

    const initMock = jest.fn();
    jest.doMock('@sentry/node', () => ({
      init: initMock,
      withScope: jest.fn(),
      captureException: jest.fn()
    }));

    const { initApiSentry } = require('../_sentry');
    initApiSentry();

    expect(initMock).toHaveBeenCalledTimes(1);
    const options = initMock.mock.calls[0][0];
    expect(options.dsn).toBe('https://api@example.ingest.sentry.io/3');
  });
});
