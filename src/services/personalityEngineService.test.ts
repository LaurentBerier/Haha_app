import { ARTIST_IDS } from '../config/constants';
import { buildSystemPrompt, buildSystemPromptForArtist } from './personalityEngineService';

describe('personalityEngineService', () => {
  it('builds Cathy prompt with mode-specific instructions', () => {
    const prompt = buildSystemPromptForArtist(ARTIST_IDS.CATHY_GAUTHIER, 'roast', null, 'fr-CA');

    expect(prompt).toContain('Tu es Cathy Gauthier');
    expect(prompt).toContain('## MODE ACTIF : roast');
    expect(prompt).toContain("L'utilisateur veut se faire roaster");
    expect(prompt).toContain('## MARQUEURS AUDIO');
    expect(prompt).toContain('[laughs]');
  });

  it('builds On Jase prompt as "Dis-moi la verite" without roast framing', () => {
    const prompt = buildSystemPromptForArtist(ARTIST_IDS.CATHY_GAUTHIER, 'on-jase', null, 'fr-CA');

    expect(prompt).toContain('## MODE ACTIF : on-jase');
    expect(prompt).toContain('Ce mode s\'appelle "Dis-moi la verite"');
    expect(prompt).toContain('Pas en mode roast');
    expect(prompt).not.toContain("L'utilisateur veut se faire roaster");
  });

  it('builds screenshot analyzer prompt for screenshot and pasted text input', () => {
    const prompt = buildSystemPromptForArtist(ARTIST_IDS.CATHY_GAUTHIER, 'screenshot-analyzer', null, 'fr-CA');

    expect(prompt).toContain('Mode "Jugement de Texto"');
    expect(prompt).toContain("capture d'ecran OU coller un echange texte");
    expect(prompt).toContain('UNE replique prete a envoyer');
  });

  it('builds fallback prompt for unknown artist profiles without Cathy mode coupling', () => {
    const prompt = buildSystemPromptForArtist(ARTIST_IDS.MYSTERY_ARTIST_ONE, 'roast', null, 'fr-CA');

    expect(prompt).toContain('Tu es Humoriste mystère');
    expect(prompt).toContain('## MODE ACTIF : roast');
    expect(prompt).toContain("Conversation libre. Reponds selon la personnalite de l'artiste selectionne");
    expect(prompt).not.toContain("L'utilisateur veut se faire roaster");
    expect(prompt).not.toContain('## MARQUEURS AUDIO');
  });

  it('keeps backward compatibility for buildSystemPrompt()', () => {
    const prompt = buildSystemPrompt('default', null, 'fr-CA');

    expect(prompt).toContain('Tu es Cathy Gauthier');
  });

  it('builds English prompt instructions when language is English', () => {
    const prompt = buildSystemPromptForArtist(ARTIST_IDS.CATHY_GAUTHIER, 'default', null, 'en-CA');

    expect(prompt).toContain('You are Cathy Gauthier');
    expect(prompt).toContain('## AUDIO EXPRESSION TAGS');
    expect(prompt).toContain('## ABSOLUTE RULES');
    expect(prompt).not.toContain('Tu reponds toujours en francais quebecois');
  });
});
