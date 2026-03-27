import { en } from './en';
import { fr } from './fr';

describe('chat error translations', () => {
  it('defines impro image unsupported error in both languages', () => {
    expect(typeof fr.imageNotSupportedInImpro).toBe('string');
    expect(fr.imageNotSupportedInImpro.length).toBeGreaterThan(0);
    expect(typeof en.imageNotSupportedInImpro).toBe('string');
    expect(en.imageNotSupportedInImpro.length).toBeGreaterThan(0);
  });
});
