import { generateId } from './generateId';

describe('generateId', () => {
  const originalCrypto = globalThis.crypto;

  afterEach(() => {
    Object.defineProperty(globalThis, 'crypto', {
      value: originalCrypto,
      configurable: true
    });
  });

  it('uses crypto.randomUUID when available', () => {
    Object.defineProperty(globalThis, 'crypto', {
      value: {
        randomUUID: jest.fn(() => 'uuid-123')
      },
      configurable: true
    });

    expect(generateId('msg')).toBe('msg_uuid-123');
  });

  it('falls back to legacy id format when randomUUID is unavailable', () => {
    Object.defineProperty(globalThis, 'crypto', {
      value: {},
      configurable: true
    });

    const id = generateId('conv');
    expect(id.startsWith('conv_')).toBe(true);
    expect(id.split('_').length).toBeGreaterThanOrEqual(4);
  });
});
