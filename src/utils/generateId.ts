let counter = 0;

export function generateId(prefix = 'id'): string {
  const normalizedPrefix = typeof prefix === 'string' && prefix.trim() ? prefix.trim() : 'id';
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${normalizedPrefix}_${globalThis.crypto.randomUUID()}`;
  }

  // Backward-compatible fallback for runtimes where randomUUID is unavailable.
  counter = (counter + 1) % 1_000_000;
  return `${normalizedPrefix}_${Date.now()}_${counter.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}
