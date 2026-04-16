// Temporary remote debug logger for STT debugging on physical iOS device.
// Sends console.warn calls to a local HTTP server on the dev Mac.
// REMOVE THIS FILE after debugging is complete.

const LOG_SERVER_URL = 'http://192.168.0.88:9999/log';

export function sttDebug(message: string): void {
  console.warn(message);
  // Fire-and-forget POST to the log server
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
