import { MODE_IDS } from './constants';
import { resolveModeIdCompat } from './modeCompat';

describe('modeCompat', () => {
  it('maps retired Cathy modes into On Jase compatibility flow', () => {
    expect(resolveModeIdCompat('phrase-du-jour')).toBe(MODE_IDS.ON_JASE);
    expect(resolveModeIdCompat('victime-du-jour')).toBe(MODE_IDS.ON_JASE);
  });

  it('preserves existing aliases for legacy On Jase variants', () => {
    expect(resolveModeIdCompat(MODE_IDS.RADAR_ATTITUDE)).toBe(MODE_IDS.ON_JASE);
    expect(resolveModeIdCompat(MODE_IDS.RELAX)).toBe(MODE_IDS.ON_JASE);
    expect(resolveModeIdCompat(MODE_IDS.JE_CASSE_TOUT)).toBe(MODE_IDS.ON_JASE);
  });
});
