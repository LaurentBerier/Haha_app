import { MODE_IDS } from './constants';

const MODE_ID_COMPAT: Record<string, string> = {
  [MODE_IDS.RADAR_ATTITUDE]: MODE_IDS.ON_JASE,
  [MODE_IDS.RELAX]: MODE_IDS.ON_JASE,
  [MODE_IDS.JE_CASSE_TOUT]: MODE_IDS.ON_JASE,
  'phrase-du-jour': MODE_IDS.ON_JASE,
  'victime-du-jour': MODE_IDS.ON_JASE,
  [MODE_IDS.ROAST]: MODE_IDS.GRILL,
  [MODE_IDS.COACH_BRUTAL]: MODE_IDS.GRILL
};

export function resolveModeIdCompat(modeId: string): string {
  if (typeof modeId !== 'string') {
    return MODE_IDS.DEFAULT;
  }

  const normalized = modeId.trim();
  if (!normalized) {
    return MODE_IDS.DEFAULT;
  }

  return MODE_ID_COMPAT[normalized] ?? normalized;
}
