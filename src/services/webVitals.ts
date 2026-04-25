import { Platform } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { gauge, track } from './perfTelemetry';

let started = false;

/**
 * Wires web-vitals → perfTelemetry + Sentry measurements. No-op outside web.
 * Reports each metric exactly once per page session (web-vitals semantics).
 *
 * Captured: LCP, CLS, INP, FCP, TTFB.
 */
export function startWebVitals(): void {
  if (started || Platform.OS !== 'web') return;
  if (typeof window === 'undefined') return;
  started = true;

  void (async () => {
    try {
      const wv = await import('web-vitals');

      const reporters: Array<[
        string,
        (cb: (metric: { name: string; value: number; id: string; rating?: string }) => void) => void
      ]> = [
        ['LCP', wv.onLCP],
        ['CLS', wv.onCLS],
        ['INP', wv.onINP],
        ['FCP', wv.onFCP],
        ['TTFB', wv.onTTFB]
      ];

      for (const [label, register] of reporters) {
        register((metric) => {
          gauge(`web_vitals.${label.toLowerCase()}`, metric.value, {
            rating: metric.rating ?? 'unknown'
          });
          track(`web_vitals.${label.toLowerCase()}`, {
            value_ms: Math.round(metric.value * 1000) / 1000,
            rating: metric.rating ?? 'unknown'
          });
          try {
            Sentry.setMeasurement(
              `web_vitals.${label.toLowerCase()}`,
              metric.value,
              label === 'CLS' ? 'none' : 'millisecond'
            );
          } catch {
            // Sentry may not be initialized; metric still lives in perfTelemetry.
          }
        });
      }
    } catch {
      // web-vitals failed to load; skip silently.
    }
  })();
}
