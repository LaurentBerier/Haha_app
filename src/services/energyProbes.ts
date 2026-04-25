import { Platform } from 'react-native';
import { gauge, incr, track } from './perfTelemetry';
import { subscribePageVisible } from '../hooks/usePageVisible';

let started = false;

interface BatteryManagerLike {
  level: number;
  charging: boolean;
  addEventListener: (event: string, handler: () => void) => void;
  removeEventListener?: (event: string, handler: () => void) => void;
}

interface NavigatorWithBattery extends Navigator {
  getBattery?: () => Promise<BatteryManagerLike>;
}

interface NetworkInformationLike {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
  addEventListener?: (event: string, handler: () => void) => void;
}

interface NavigatorWithConnection extends Navigator {
  connection?: NetworkInformationLike;
  deviceMemory?: number;
}

function setupBatteryProbe(): void {
  const nav = navigator as NavigatorWithBattery;
  if (typeof nav.getBattery !== 'function') return;
  let sessionStartLevel: number | null = null;
  let sessionStartTs = Date.now();

  nav
    .getBattery()
    .then((battery) => {
      sessionStartLevel = battery.level;
      gauge('battery.level', battery.level);
      gauge('battery.charging', battery.charging ? 1 : 0);

      const onChange = () => {
        gauge('battery.level', battery.level);
        gauge('battery.charging', battery.charging ? 1 : 0);
        if (sessionStartLevel !== null && !battery.charging) {
          const elapsedMs = Date.now() - sessionStartTs;
          const drop = sessionStartLevel - battery.level;
          if (elapsedMs > 60_000 && drop > 0) {
            const dropPctPerHour = (drop * 3600_000) / elapsedMs;
            gauge('battery.drop_pct_per_hour', dropPctPerHour * 100);
          }
        }
        if (battery.charging) {
          sessionStartLevel = battery.level;
          sessionStartTs = Date.now();
        }
      };
      battery.addEventListener('levelchange', onChange);
      battery.addEventListener('chargingchange', onChange);
    })
    .catch(() => {
      // Battery API unsupported or denied (Firefox, Safari without flag).
    });
}

function setupConnectionProbe(): void {
  const nav = navigator as NavigatorWithConnection;
  if (!nav.connection) return;
  const reportConnection = () => {
    if (nav.connection?.effectiveType) {
      track('network.connection_change', {
        effective_type: nav.connection.effectiveType,
        downlink_mbps: nav.connection.downlink ?? 0,
        rtt_ms: nav.connection.rtt ?? 0,
        save_data: nav.connection.saveData ?? false
      });
    }
  };
  reportConnection();
  nav.connection.addEventListener?.('change', reportConnection);

  if (typeof nav.deviceMemory === 'number') {
    gauge('device.memory_gb', nav.deviceMemory);
  }
}

function setupLongTaskObserver(): void {
  if (typeof PerformanceObserver === 'undefined') return;
  try {
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        incr('longtask.count');
        gauge('longtask.last_ms', entry.duration);
        if (entry.duration >= 100) {
          track('longtask.heavy', { duration_ms: Math.round(entry.duration) });
        }
      }
    });
    obs.observe({ type: 'longtask', buffered: true });
  } catch {
    // longtask not supported (Safari before 16.4).
  }
}

function setupLayoutShiftObserver(): void {
  if (typeof PerformanceObserver === 'undefined') return;
  try {
    let cumulative = 0;
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput?: boolean }>) {
        if (entry.hadRecentInput) continue;
        cumulative += entry.value;
        gauge('layout_shift.cumulative', cumulative);
      }
    });
    obs.observe({ type: 'layout-shift', buffered: true });
  } catch {
    // unsupported
  }
}

function setupFrameRateProbe(): void {
  if (typeof requestAnimationFrame !== 'function') return;
  let frames = 0;
  let droppedFrames = 0;
  let lastTs = performance.now();
  let lastReport = lastTs;
  let visible = true;
  let rafId: number | null = null;

  const tick = (ts: number) => {
    if (!visible) {
      rafId = null;
      return;
    }
    frames += 1;
    const delta = ts - lastTs;
    if (delta > 50) {
      droppedFrames += 1;
    }
    lastTs = ts;
    if (ts - lastReport >= 5000) {
      const elapsed = (ts - lastReport) / 1000;
      const fps = frames / elapsed;
      gauge('fps.avg_5s', fps);
      gauge('fps.dropped_count_5s', droppedFrames);
      frames = 0;
      droppedFrames = 0;
      lastReport = ts;
    }
    rafId = requestAnimationFrame(tick);
  };

  const start = () => {
    if (rafId !== null) return;
    visible = true;
    lastTs = performance.now();
    lastReport = lastTs;
    rafId = requestAnimationFrame(tick);
  };

  const stop = () => {
    visible = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  start();
  subscribePageVisible((isVisible) => {
    if (isVisible) start();
    else stop();
  });
}

function setupTimerCountProbe(): void {
  if (typeof globalThis === 'undefined') return;
  const w = globalThis as typeof globalThis & {
    setTimeout: typeof setTimeout;
    clearTimeout: typeof clearTimeout;
    setInterval: typeof setInterval;
    clearInterval: typeof clearInterval;
  };

  const liveTimeouts = new Set<unknown>();
  const liveIntervals = new Set<unknown>();

  const origSetTimeout = w.setTimeout;
  const origClearTimeout = w.clearTimeout;
  const origSetInterval = w.setInterval;
  const origClearInterval = w.clearInterval;

  w.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const wrappedHandler =
      typeof handler === 'function'
        ? (...callArgs: unknown[]) => {
            liveTimeouts.delete(id);
            try {
              return (handler as (...a: unknown[]) => unknown)(...callArgs);
            } finally {
              gauge('timers.timeouts_active', liveTimeouts.size);
            }
          }
        : handler;
    const id = origSetTimeout(wrappedHandler as TimerHandler, timeout, ...args);
    liveTimeouts.add(id);
    gauge('timers.timeouts_active', liveTimeouts.size);
    return id;
  }) as typeof setTimeout;

  w.clearTimeout = ((id: Parameters<typeof clearTimeout>[0]) => {
    if (id !== undefined) liveTimeouts.delete(id);
    gauge('timers.timeouts_active', liveTimeouts.size);
    return origClearTimeout(id);
  }) as typeof clearTimeout;

  w.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const id = origSetInterval(handler, timeout, ...args);
    liveIntervals.add(id);
    gauge('timers.intervals_active', liveIntervals.size);
    return id;
  }) as typeof setInterval;

  w.clearInterval = ((id: Parameters<typeof clearInterval>[0]) => {
    if (id !== undefined) liveIntervals.delete(id);
    gauge('timers.intervals_active', liveIntervals.size);
    return origClearInterval(id);
  }) as typeof clearInterval;
}

/**
 * Wires battery, network info, long tasks, layout shift, frame rate, and
 * active timer probes into perfTelemetry. Idempotent; safe to call multiple
 * times. Skips probes whose APIs are unavailable on the current runtime.
 */
export function startEnergyProbes(): void {
  if (started) return;
  started = true;

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    setupBatteryProbe();
    setupConnectionProbe();
    setupLongTaskObserver();
    setupLayoutShiftObserver();
    setupFrameRateProbe();
  }

  setupTimerCountProbe();
}
