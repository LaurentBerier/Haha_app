import { Platform } from 'react-native';
import { getTelemetrySnapshot } from './perfTelemetry';

let overlay: HTMLElement | null = null;
let visible = false;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

const isDev = (): boolean =>
  typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';

function renderOverlay(): void {
  if (!overlay) return;
  const snap = getTelemetrySnapshot();
  const counters = Object.entries(snap.counters)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n');
  const gauges = Object.entries(snap.gauges)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `  ${k}: ${typeof v === 'number' ? v.toFixed(2) : v}`)
    .join('\n');
  const recent = snap.recent
    .slice(-15)
    .map((e) => {
      const t = new Date(e.ts).toISOString().slice(11, 23);
      const v = e.value !== undefined ? ` (${Math.round(e.value)})` : '';
      return `  ${t} ${e.kind} ${e.name}${v}`;
    })
    .join('\n');

  overlay.textContent = [
    `[perf overlay] ${snap.platform}`,
    '',
    'COUNTERS',
    counters || '  (none)',
    '',
    'GAUGES',
    gauges || '  (none)',
    '',
    'RECENT',
    recent || '  (none)'
  ].join('\n');
}

/**
 * Toggles a developer-only perf overlay (web). Shows live counters, gauges,
 * and the last few telemetry events. No-op outside web or in production.
 *
 * Wire to a hidden gesture (e.g. triple-tap) or a dev-only button.
 */
export function togglePerfDebugOverlay(): void {
  if (Platform.OS !== 'web') return;
  if (typeof document === 'undefined') return;
  if (!isDev()) return;

  if (visible && overlay) {
    overlay.style.display = 'none';
    visible = false;
    if (refreshTimer !== null) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    return;
  }

  if (!overlay) {
    overlay = document.createElement('pre');
    overlay.id = 'haha-perf-overlay';
    Object.assign(overlay.style, {
      position: 'fixed',
      top: '0',
      right: '0',
      width: 'min(360px, 60vw)',
      maxHeight: '60vh',
      background: 'rgba(0, 12, 24, 0.92)',
      color: '#7ef9ff',
      fontSize: '10px',
      lineHeight: '1.35',
      fontFamily: 'monospace',
      padding: '8px 10px',
      overflow: 'auto',
      zIndex: '999999',
      pointerEvents: 'auto',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-all',
      borderBottomLeftRadius: '6px'
    });
    document.body.appendChild(overlay);
  }

  overlay.style.display = 'block';
  visible = true;
  renderOverlay();
  refreshTimer = setInterval(renderOverlay, 1000);
}

export function isPerfDebugOverlayVisible(): boolean {
  return visible;
}
