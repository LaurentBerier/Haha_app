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

  it('includes dedicated prompts for coach-de-vie, meteo and numero-de-show', () => {
    const coachPrompt = buildSystemPromptForArtist(ARTIST_IDS.CATHY_GAUTHIER, 'coach-de-vie', null, 'fr-CA');
    const meteoPrompt = buildSystemPromptForArtist(ARTIST_IDS.CATHY_GAUTHIER, 'meteo', null, 'fr-CA');
    const showPrompt = buildSystemPromptForArtist(ARTIST_IDS.CATHY_GAUTHIER, 'numero-de-show', null, 'fr-CA');

    expect(coachPrompt).toContain("L'utilisateur veut du coaching concret.");
    expect(meteoPrompt).toContain("L'utilisateur veut la meteo version Cathy.");
    expect(showPrompt).toContain("L'utilisateur veut un mini numero d'humour.");
  });

  it('lists available modes for Cathy in the base system prompt', () => {
    const prompt = buildSystemPromptForArtist(ARTIST_IDS.CATHY_GAUTHIER, 'on-jase', null, 'fr-CA');

    expect(prompt).toContain('## MODES DISPONIBLES');
    expect(prompt).toContain('Dis-moi la vérité');
    expect(prompt).toContain('Coach de vie');
    expect(prompt).toContain('Meteo');
    expect(prompt).toContain('Numéro de show');
  });
});
