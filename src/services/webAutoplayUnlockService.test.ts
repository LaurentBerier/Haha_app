jest.mock('react-native', () => ({
  Platform: {
    OS: 'web'
  }
}));

import {
  __resetWebAutoplayUnlockServiceForTests,
  hasWebAutoplaySessionUnlock,
  markWebAutoplaySessionUnlocked,
  queueLatestWebAutoplayUnlockRetry
} from './webAutoplayUnlockService';

class MockDocumentEvents {
  private listeners = new Map<string, Set<() => void>>();

  addEventListener(eventName: string, handler: () => void): void {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }
    this.listeners.get(eventName)?.add(handler);
  }

  removeEventListener(eventName: string, handler: () => void): void {
    this.listeners.get(eventName)?.delete(handler);
  }

  emit(eventName: string): void {
    const handlers = this.listeners.get(eventName);
    if (!handlers) {
      return;
    }
    handlers.forEach((handler) => {
      handler();
    });
  }
}

describe('webAutoplayUnlockService', () => {
  const originalDocument = (globalThis as { document?: unknown }).document;
  let mockDocumentEvents: MockDocumentEvents;

  beforeEach(() => {
    mockDocumentEvents = new MockDocumentEvents();
    (globalThis as { document?: unknown }).document = mockDocumentEvents;
    __resetWebAutoplayUnlockServiceForTests();
  });

  afterEach(() => {
    __resetWebAutoplayUnlockServiceForTests();
    (globalThis as { document?: unknown }).document = originalDocument;
  });

  it('keeps only the latest queued retry callback before unlock (latest wins)', () => {
    const firstRetry = jest.fn();
    const secondRetry = jest.fn();

    queueLatestWebAutoplayUnlockRetry(firstRetry);
    queueLatestWebAutoplayUnlockRetry(secondRetry);
    expect(firstRetry).not.toHaveBeenCalled();
    expect(secondRetry).not.toHaveBeenCalled();

    mockDocumentEvents.emit('pointerdown');

    expect(firstRetry).not.toHaveBeenCalled();
    expect(secondRetry).toHaveBeenCalledTimes(1);
  });

  it('marks session unlocked after first gesture and runs future retries immediately', () => {
    const queuedRetry = jest.fn();
    queueLatestWebAutoplayUnlockRetry(queuedRetry);
    expect(hasWebAutoplaySessionUnlock()).toBe(false);

    mockDocumentEvents.emit('pointerdown');
    expect(queuedRetry).toHaveBeenCalledTimes(1);
    expect(hasWebAutoplaySessionUnlock()).toBe(true);

    const immediateRetry = jest.fn();
    queueLatestWebAutoplayUnlockRetry(immediateRetry);
    expect(immediateRetry).toHaveBeenCalledTimes(1);
  });

  it('supports explicit unlock marking without waiting for DOM gesture handlers', () => {
    expect(hasWebAutoplaySessionUnlock()).toBe(false);

    markWebAutoplaySessionUnlocked();
    expect(hasWebAutoplaySessionUnlock()).toBe(true);

    const retry = jest.fn();
    queueLatestWebAutoplayUnlockRetry(retry);
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
