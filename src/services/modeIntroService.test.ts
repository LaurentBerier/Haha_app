import { MODE_IDS } from '../config/constants';
import { generateModeIntro } from './modeIntroService';

describe('modeIntroService fallback intro', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('includes user name, mode concept and conversation invitation for Dis-moi la verite', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);

    const intro = generateModeIntro(MODE_IDS.ON_JASE, {
      id: 'user-1',
      preferredName: 'Laurent',
      age: null,
      sex: null,
      relationshipStatus: null,
      horoscopeSign: null,
      interests: [],
      memoryFacts: [],
      onboardingCompleted: false,
      onboardingSkipped: false
    });

    expect(intro).toContain('Hey Laurent');
    expect(intro).toContain('Dis-moi la verite');
    expect(intro).toContain("Ici j'suis cash");
    expect(intro).toContain('Raconte-moi une situation precise');
  });

  it('uses a neutral address when no preferred name is provided', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);

    const intro = generateModeIntro(MODE_IDS.GRILL, null);

    expect(intro).toContain('Hey toi');
    expect(intro).toContain('Mets-moi sur le grill');
    expect(intro).not.toContain('undefined');
  });

  it('produces varied intros across calls', () => {
    const randomSpy = jest.spyOn(Math, 'random');
    randomSpy.mockReturnValue(0);
    const first = generateModeIntro(MODE_IDS.ON_JASE, null);

    randomSpy.mockReturnValue(0.99);
    const second = generateModeIntro(MODE_IDS.ON_JASE, null);

    expect(first).not.toEqual(second);
  });

  it('returns an image-first intro fallback for meme-generator', () => {
    const intro = generateModeIntro(MODE_IDS.MEME_GENERATOR, null);

    expect(intro.toLowerCase()).toContain('image');
    expect(intro.toLowerCase()).toContain('caption');
    expect(intro).toContain('petit +');
  });
});
