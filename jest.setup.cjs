/* global jest */

const asyncStorageMock = {
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
  clear: jest.fn(() => Promise.resolve())
};

jest.mock('@react-native-async-storage/async-storage', () => asyncStorageMock);

jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  addBreadcrumb: jest.fn(),
  setMeasurement: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  withScope: (fn) => fn({ setTag: jest.fn(), setContext: jest.fn() }),
  browserReplayIntegration: () => ({ name: 'browserReplay' }),
  startSpan: (_opts, cb) => cb({ end: jest.fn() }),
  startInactiveSpan: () => ({ end: jest.fn() })
}));
