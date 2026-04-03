import { MODE_IDS } from './constants';
import { resolveModeIdCompat } from './modeCompat';

describe('modeCompat', () => {
  it('keeps canonical ids untouched', () => {
    expect(resolveModeIdCompat(MODE_IDS.ON_JASE)).toBe(MODE_IDS.ON_JASE);
    expect(resolveModeIdCompat(MODE_IDS.GRILL)).toBe(MODE_IDS.GRILL);
  });

  it('does not remap retired aliases anymore', () => {
    expect(resolveModeIdCompat('phrase-du-jour')).toBe('phrase-du-jour');
    expect(resolveModeIdCompat('victime-du-jour')).toBe('victime-du-jour');
    expect(resolveModeIdCompat(MODE_IDS.ROAST)).toBe(MODE_IDS.ROAST);
  });
});
