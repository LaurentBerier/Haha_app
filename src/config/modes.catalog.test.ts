import { MODE_IDS } from './constants';
import { CATEGORY_MODE_IDS } from './modeCategories';
import { getModeById } from './modes';

describe('mode catalog', () => {
  it('renames on-jase and screenshot-analyzer while preserving ids', () => {
    expect(getModeById(MODE_IDS.ON_JASE)?.name).toBe('Dis-moi la vérité');
    expect(getModeById(MODE_IDS.SCREENSHOT_ANALYZER)?.name).toBe('Jugement de Texto');
  });

  it('removes phrase-du-jour and victime-du-jour from mode lookup', () => {
    expect(getModeById('phrase-du-jour')).toBeNull();
    expect(getModeById('victime-du-jour')).toBeNull();
  });

  it('keeps experiences category without removed modes', () => {
    expect(CATEGORY_MODE_IDS.experiences).toEqual([
      MODE_IDS.MEME_GENERATOR,
      MODE_IDS.SCREENSHOT_ANALYZER,
      MODE_IDS.NUMERO_DE_SHOW
    ]);
    expect(CATEGORY_MODE_IDS.experiences).not.toContain('phrase-du-jour');
    expect(CATEGORY_MODE_IDS.experiences).not.toContain('victime-du-jour');
  });
});
