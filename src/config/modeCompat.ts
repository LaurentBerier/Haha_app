import { MODE_IDS } from './constants';

export function resolveModeIdCompat(modeId: string): string {
  if (typeof modeId !== 'string') {
    return MODE_IDS.DEFAULT;
  }

  const normalized = modeId.trim();
  if (!normalized) {
    return MODE_IDS.DEFAULT;
  }

  return normalized;
}
