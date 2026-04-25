import * as Sentry from '@sentry/react-native';
import { subscribePageVisible } from '../hooks/usePageVisible';

function detectPlatform(): string {
  if (typeof navigator !== 'undefined' && typeof navigator.product === 'string' && navigator.product === 'ReactNative') {
    return 'native';
  }
  if (typeof document !== 'undefined') {
    return 'web';
  }
  return 'unknown';
}

type Tags = Record<string, string | number | boolean>;

interface RingEntry {
  ts: number;
  kind: 'measure' | 'event' | 'gauge' | 'incr';
  name: string;
  value?: number;
  tags?: Tags;
}

const RING_CAPACITY = 200;
const ring: RingEntry[] = [];
let ringHead = 0;

const counters = new Map<string, number>();
const gauges = new Map<string, number>();
const activeMarks = new Map<string, number>();

function pushRing(entry: RingEntry): void {
  if (ring.length < RING_CAPACITY) {
    ring.push(entry);
  } else {
    ring[ringHead] = entry;
    ringHead = (ringHead + 1) % RING_CAPACITY;
  }
}

function isDev(): boolean {
  return typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function tagsToBreadcrumb(tags?: Tags): Record<string, string | number | boolean> | undefined {
  if (!tags) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(tags)) {
    out[k] = v;
  }
  return out;
}

/**
 * Marks a perf checkpoint. Use with `measure(name)` to capture an interval.
 */
export function mark(name: string): void {
  activeMarks.set(name, nowMs());
}

/**
 * Closes a `mark()` interval and reports the duration as a Sentry measurement
 * + breadcrumb. Returns the duration in ms (or null if `mark` was missing).
 */
export function measure(name: string, tags?: Tags): number | null {
  const start = activeMarks.get(name);
  if (start === undefined) {
    return null;
  }
  activeMarks.delete(name);
  const durationMs = nowMs() - start;
  pushRing({ ts: Date.now(), kind: 'measure', name, value: durationMs, tags });

  safe(() => {
    Sentry.addBreadcrumb({
      category: 'perf',
      level: 'info',
      message: name,
      data: { duration_ms: Math.round(durationMs), ...tagsToBreadcrumb(tags) }
    });
    Sentry.setMeasurement(`perf.${name}`, durationMs, 'millisecond');
  });

  return durationMs;
}

/**
 * Wraps an async function in a perf measurement. Reports duration + outcome
 * tag (`ok` | `error`).
 */
export async function withMeasure<T>(name: string, fn: () => Promise<T>, tags?: Tags): Promise<T> {
  const start = nowMs();
  let outcome: 'ok' | 'error' = 'ok';
  try {
    return await fn();
  } catch (err) {
    outcome = 'error';
    throw err;
  } finally {
    const durationMs = nowMs() - start;
    pushRing({ ts: Date.now(), kind: 'measure', name, value: durationMs, tags: { ...tags, outcome } });
    safe(() => {
      Sentry.addBreadcrumb({
        category: 'perf',
        level: outcome === 'ok' ? 'info' : 'warning',
        message: name,
        data: { duration_ms: Math.round(durationMs), outcome, ...tagsToBreadcrumb(tags) }
      });
      Sentry.setMeasurement(`perf.${name}`, durationMs, 'millisecond');
    });
  }
}

export function incr(name: string, by = 1, tags?: Tags): void {
  const next = (counters.get(name) ?? 0) + by;
  counters.set(name, next);
  pushRing({ ts: Date.now(), kind: 'incr', name, value: by, tags });
}

export function gauge(name: string, value: number, tags?: Tags): void {
  gauges.set(name, value);
  pushRing({ ts: Date.now(), kind: 'gauge', name, value, tags });
}

/**
 * Tracks a discrete event (no duration). Goes to Sentry as a breadcrumb.
 */
export function track(name: string, tags?: Tags): void {
  pushRing({ ts: Date.now(), kind: 'event', name, tags });
  safe(() => {
    Sentry.addBreadcrumb({
      category: 'perf.event',
      level: 'info',
      message: name,
      data: tagsToBreadcrumb(tags)
    });
  });
}

export interface TelemetrySnapshot {
  platform: string;
  ringSize: number;
  counters: Record<string, number>;
  gauges: Record<string, number>;
  recent: RingEntry[];
}

export function getTelemetrySnapshot(): TelemetrySnapshot {
  const recent = ring.length < RING_CAPACITY
    ? [...ring]
    : [...ring.slice(ringHead), ...ring.slice(0, ringHead)];
  return {
    platform: detectPlatform(),
    ringSize: ring.length,
    counters: Object.fromEntries(counters),
    gauges: Object.fromEntries(gauges),
    recent
  };
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_INTERVAL_MS = 30_000;

function flushSummary(): void {
  if (counters.size === 0 && gauges.size === 0) {
    return;
  }
  const summary: Record<string, number> = {};
  for (const [k, v] of counters) summary[`count.${k}`] = v;
  for (const [k, v] of gauges) summary[`gauge.${k}`] = v;
  safe(() => {
    Sentry.addBreadcrumb({
      category: 'perf.summary',
      level: 'info',
      message: 'periodic perf flush',
      data: summary
    });
    for (const [k, v] of Object.entries(summary)) {
      Sentry.setMeasurement(`perf.${k}`, v, 'none');
    }
  });
  if (isDev()) {
    // eslint-disable-next-line no-console
    console.log('[perf]', summary);
  }
}

let started = false;

/**
 * Starts the periodic flush + visibility-driven flush. Idempotent. Safe to
 * call multiple times — only the first call wires up listeners.
 */
export function startPerfTelemetry(): void {
  if (started) return;
  started = true;

  flushTimer = setInterval(flushSummary, FLUSH_INTERVAL_MS);

  subscribePageVisible((visible) => {
    if (!visible) {
      flushSummary();
    }
  });
}

export function stopPerfTelemetryForTests(): void {
  if (flushTimer !== null) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  started = false;
  ring.length = 0;
  ringHead = 0;
  counters.clear();
  gauges.clear();
  activeMarks.clear();
}
