import { ARTIST_IDS } from '../config/constants';
import { buildSystemPrompt, buildSystemPromptForArtist } from './personalityEngineService';

describe('personalityEngineService', () => {
  it('builds Cathy prompt with mode-specific instructions', () => {
    const prompt = buildSystemPromptForArtist(ARTIST_IDS.CATHY_GAUTHIER, 'roast', null, 'fr-CA');

    expect(prompt).toContain('Tu es Cathy Gauthier');
    expect(prompt).toContain('## MODE ACTIF : roast');
    expect(prompt).toContain("L'utilisateur veut se faire roaster");
  });

  it('builds fallback prompt for unknown artist profiles without Cathy mode coupling', () => {
    const prompt = buildSystemPromptForArtist(ARTIST_IDS.MYSTERY_ARTIST_ONE, 'roast', null, 'fr-CA');

    expect(prompt).toContain('Tu es ???');
    expect(prompt).toContain('## MODE ACTIF : roast');
    expect(prompt).toContain("Conversation libre. Reponds selon la personnalite de l'artiste selectionne");
    expect(prompt).not.toContain("L'utilisateur veut se faire roaster");
  });

  it('keeps backward compatibility for buildSystemPrompt()', () => {
    const prompt = buildSystemPrompt('default', null, 'fr-CA');

    expect(prompt).toContain('Tu es Cathy Gauthier');
  });

  it('builds English prompt instructions when language is English', () => {
    const prompt = buildSystemPromptForArtist(ARTIST_IDS.CATHY_GAUTHIER, 'default', null, 'en-CA');

    expect(prompt).toContain('You are Cathy Gauthier');
    expect(prompt).toContain('## ABSOLUTE RULES');
    expect(prompt).not.toContain('Tu reponds toujours en francais quebecois');
  });
});
