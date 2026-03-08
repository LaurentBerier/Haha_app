type HapticsModule = {
  ImpactFeedbackStyle: {
    Light: number;
    Medium: number;
  };
  NotificationFeedbackType: {
    Success: number;
    Warning: number;
  };
  impactAsync: (style: number) => Promise<void>;
  notificationAsync: (type: number) => Promise<void>;
};

let cachedModule: HapticsModule | null | undefined;

function getHapticsModule(): HapticsModule | null {
  if (cachedModule !== undefined) {
    return cachedModule;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedModule = require('expo-haptics') as HapticsModule;
  } catch {
    cachedModule = null;
  }

  return cachedModule;
}

async function safeCall(task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch {
    // Ignore haptics failures; UX enhancement only.
  }
}

export async function impactLight(): Promise<void> {
  const module = getHapticsModule();
  if (!module) {
    return;
  }

  await safeCall(() => module.impactAsync(module.ImpactFeedbackStyle.Light));
}

export async function impactMedium(): Promise<void> {
  const module = getHapticsModule();
  if (!module) {
    return;
  }

  await safeCall(() => module.impactAsync(module.ImpactFeedbackStyle.Medium));
}

export async function notifySuccess(): Promise<void> {
  const module = getHapticsModule();
  if (!module) {
    return;
  }

  await safeCall(() => module.notificationAsync(module.NotificationFeedbackType.Success));
}

export async function notifyWarning(): Promise<void> {
  const module = getHapticsModule();
  if (!module) {
    return;
  }

  await safeCall(() => module.notificationAsync(module.NotificationFeedbackType.Warning));
}
