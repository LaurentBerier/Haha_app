type UnlockRetryCallback = () => void;

function isWebRuntime(): boolean {
  return typeof document !== 'undefined';
}

let isSessionUnlocked = !isWebRuntime();
let latestPendingRetry: UnlockRetryCallback | null = null;
let detachUnlockListenersRef: (() => void) | null = null;

function canAttachListeners(): boolean {
  return isWebRuntime() && typeof document !== 'undefined';
}

function clearUnlockListeners(): void {
  detachUnlockListenersRef?.();
  detachUnlockListenersRef = null;
}

function flushLatestPendingRetry(): void {
  const pendingRetry = latestPendingRetry;
  latestPendingRetry = null;
  pendingRetry?.();
}

function attachUnlockListeners(): void {
  if (!canAttachListeners() || isSessionUnlocked || detachUnlockListenersRef) {
    return;
  }

  const events: Array<keyof DocumentEventMap> = ['pointerdown', 'keydown', 'touchstart', 'mousedown'];
  const options: AddEventListenerOptions = { once: true, capture: true };
  const handleUnlockGesture = () => {
    markWebAutoplaySessionUnlocked();
  };

  events.forEach((eventName) => {
    document.addEventListener(eventName, handleUnlockGesture, options);
  });

  detachUnlockListenersRef = () => {
    events.forEach((eventName) => {
      document.removeEventListener(eventName, handleUnlockGesture, options);
    });
  };
}

export function hasWebAutoplaySessionUnlock(): boolean {
  return !isWebRuntime() || isSessionUnlocked;
}

export function markWebAutoplaySessionUnlocked(): void {
  if (!isWebRuntime() || isSessionUnlocked) {
    return;
  }

  isSessionUnlocked = true;
  clearUnlockListeners();
  flushLatestPendingRetry();
}

export function queueLatestWebAutoplayUnlockRetry(retry: UnlockRetryCallback): void {
  // #region agent log
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if(typeof window!=='undefined'){((window as any).__dbg=((window as any).__dbg||[])).push({t:Date.now(),l:'unlock:queueRetry',d:{unlocked:isSessionUnlocked,immediate:isWebRuntime()&&isSessionUnlocked}});console.warn('[DBG]unlockRetry',{unlocked:isSessionUnlocked});}
  // #endregion
  if (!isWebRuntime()) {
    retry();
    return;
  }

  if (isSessionUnlocked) {
    retry();
    return;
  }

  latestPendingRetry = retry;
  attachUnlockListeners();
}

export function clearPendingWebAutoplayUnlockRetry(): void {
  latestPendingRetry = null;
}

export function __resetWebAutoplayUnlockServiceForTests(): void {
  clearPendingWebAutoplayUnlockRetry();
  clearUnlockListeners();
  isSessionUnlocked = !isWebRuntime();
}
