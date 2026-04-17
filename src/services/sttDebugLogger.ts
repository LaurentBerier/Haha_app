// Temporary remote debug logger for STT debugging on physical iOS device.
// Sends console.warn calls to a local HTTP server on the dev Mac,
// and stores logs in memory for an on-screen overlay on Vercel previews.
// REMOVE THIS FILE after debugging is complete.

// Use same-origin /api/debug-log on Vercel preview (HTTPS-safe), fall back to
// LAN log server for local dev.
const LOG_SERVER_URL = (() => {
  if (typeof window === 'undefined') return null;
  const proto = window.location?.protocol ?? '';
  if (proto === 'https:') {
    // Vercel preview — same-origin endpoint, no mixed-content issue
    return '/api/debug-log';
  }
  // Local dev — use LAN log server (HTTP)
  const hostname = window.location?.hostname ?? '';
  if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(hostname)) {
    return `http://${hostname}:9999/log`;
  }
  return null;
})();
const MAX_LOG_ENTRIES = 150;

const logBuffer: string[] = [];
let overlayElement: HTMLElement | null = null;
let overlayVisible = false;
const listeners: Array<() => void> = [];

export function sttDebug(message: string): void {
  console.warn(message);

  // Store in memory buffer for on-screen overlay
  const timestamp = new Date().toISOString().slice(11, 23);
  const entry = `[${timestamp}] ${message}`;
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG_ENTRIES) {
    logBuffer.shift();
  }
  for (const listener of listeners) {
    listener();
  }
  updateOverlayContent();

  // Fire-and-forget POST to the log relay (same-origin on Vercel, LAN on local dev)
  if (LOG_SERVER_URL) {
    try {
      fetch(LOG_SERVER_URL, {
        method: 'POST',
        body: message,
        headers: { 'Content-Type': 'text/plain' },
      }).catch(() => {
        // silently ignore network errors
      });
    } catch {
      // silently ignore
    }
  }
}

export function getSttDebugLogs(): readonly string[] {
  return logBuffer;
}

export function onSttDebugLog(listener: () => void): () => void {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

function updateOverlayContent(): void {
  if (!overlayElement || !overlayVisible) return;
  overlayElement.textContent = logBuffer.slice(-60).join('\n');
  overlayElement.scrollTop = overlayElement.scrollHeight;
}

export function toggleSttDebugOverlay(): void {
  if (typeof document === 'undefined') return;

  if (overlayVisible && overlayElement) {
    overlayElement.style.display = 'none';
    overlayVisible = false;
    return;
  }

  if (!overlayElement) {
    overlayElement = document.createElement('pre');
    overlayElement.id = 'stt-debug-overlay';
    Object.assign(overlayElement.style, {
      position: 'fixed',
      bottom: '0',
      left: '0',
      right: '0',
      height: '35vh',
      background: 'rgba(0,0,0,0.88)',
      color: '#0f0',
      fontSize: '9px',
      lineHeight: '1.3',
      fontFamily: 'monospace',
      padding: '6px',
      overflow: 'auto',
      zIndex: '99999',
      pointerEvents: 'auto',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-all',
    });
    document.body.appendChild(overlayElement);
  }

  overlayElement.style.display = 'block';
  overlayVisible = true;
  updateOverlayContent();
}
