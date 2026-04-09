import { ARTIST_IDS } from '../config/constants';
import { buildSystemPrompt, buildSystemPromptForArtist } from './personalityEngineService';

describe('personalityEngineService', () => {
  it('keeps retired mode ids unmapped in Cathy prompt generation', () => {
    const prompt = buildSystemPromptForArtist(ARTIST_IDS.CATHY_GAUTHIER, 'roast', null, 'fr-CA');

    expect(prompt).toContain('Tu es Cathy Gauthier');
    expect(prompt).toContain('## MODE ACTIF : roast');
    expect(prompt).toContain('Conversation libre. Reponds comme Cathy dans une discussion informelle');
    expect(prompt).not.toContain("L'utilisateur veut se faire roaster");
    expect(prompt).toContain('## MARQUEURS AUDIO');
    expect(prompt).toContain('[laughs]');
    expect(prompt).toContain("## POLITIQUE INFO D'ABORD");
    expect(prompt).toContain('Reponds d\'abord au fond de la demande avant toute blague.');
    expect(prompt).toContain('Tu ne te refugies jamais derriere "je suis juste une humoriste"');
  });

  it('builds On Jase prompt as "Dis-moi la vérité" without roast framing', () => {
    const prompt = buildSystemPromptForArtist(ARTIST_IDS.CATHY_GAUTHIER, 'on-jase', null, 'fr-CA');

    expect(prompt).toContain('## MODE ACTIF : on-jase');
    expect(prompt).toContain('Ce mode s\'appelle "Dis-moi la vérité"');
    expect(prompt).toContain('Pas en mode roast');
    expect(prompt).toContain('Si la reponse utilisateur est vague');
    expect(prompt).toContain('Questions ciblees possibles');
    expect(prompt).not.toContain("L'utilisateur veut se faire roaster");
  });

  it('builds Grill prompt with targeted follow-up when user input is too vague', () => {
    const prompt = buildSystemPromptForArtist(ARTIST_IDS.CATHY_GAUTHIER, 'grill', null, 'fr-CA');

    expect(prompt).toContain("L'utilisateur veut se faire roaster");
    expect(prompt).toContain('Si la reponse utilisateur est vague');
    expect(prompt).toContain('Questions ciblees possibles');
    expect(prompt).toContain('roast intelligent et drole');
  });

  it('builds screenshot analyzer prompt for screenshot and pasted text input', () => {
    const prompt = buildSystemPromptForArtist(ARTIST_IDS.CATHY_GAUTHIER, 'screenshot-analyzer', null, 'fr-CA');

    expect(prompt).toContain('Mode "Jugement de Texto"');
    expect(prompt).toContain("capture d'ecran OU coller un echange texte");
    expect(prompt).toContain('UNE réplique prete a envoyer');
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
    expect(prompt).toContain('## INFORMATION-FIRST POLICY');
    expect(prompt).toContain('Never dodge informational questions with "I am just a comedian"');
    expect(prompt).not.toContain('Tu reponds toujours en francais quebecois');
  });

  it('includes dedicated prompts for coach-de-vie, meteo and numero-de-show', () => {
    const coachPrompt = buildSystemPromptForArtist(ARTIST_IDS.CATHY_GAUTHIER, 'coach-de-vie', null, 'fr-CA');
    const meteoPrompt = buildSystemPromptForArtist(ARTIST_IDS.CATHY_GAUTHIER, 'meteo', null, 'fr-CA');
    const showPrompt = buildSystemPromptForArtist(ARTIST_IDS.CATHY_GAUTHIER, 'numero-de-show', null, 'fr-CA');

    expect(coachPrompt).toContain("L'utilisateur veut du coaching concret.");
    expect(meteoPrompt).toContain("L'utilisateur veut la meteo version Cathy.");
    expect(showPrompt).toContain("L'utilisateur veut un mini numéro d'humour.");
  });

  it('lists only visible launchable experiences for Cathy in the base system prompt', () => {
    const prompt = buildSystemPromptForArtist(ARTIST_IDS.CATHY_GAUTHIER, 'on-jase', null, 'fr-CA');

    expect(prompt).toContain('## MODES ET JEUX DISPONIBLES');
    expect(prompt).toContain('Mode: Dis-moi la vérité');
    expect(prompt).toContain('Mode: Numéro de show');
    expect(prompt).toContain('Jeu: Impro');
    expect(prompt).not.toContain('Coach de vie');
    expect(prompt).not.toContain('Meteo');
  });

  it('respects emojiStyle off and full in French Cathy prompt', () => {
    const offPrompt = buildSystemPromptForArtist(ARTIST_IDS.CATHY_GAUTHIER, 'on-jase', null, 'fr-CA', null, 'off');
    expect(offPrompt).toContain("N'utilise aucun emoji dans le corps");

    const fullPrompt = buildSystemPromptForArtist(ARTIST_IDS.CATHY_GAUTHIER, 'on-jase', null, 'fr-CA', null, 'full');
    expect(fullPrompt).toMatch(/🤣|💅/);
  });

  it('includes anti-sycophancy adaptation section in FR and EN', () => {
    const frPrompt = buildSystemPromptForArtist(ARTIST_IDS.CATHY_GAUTHIER, 'on-jase', null, 'fr-CA');
    expect(frPrompt).toContain('## ADAPTATION SANS FLAGORNERIE');
    expect(frPrompt).toContain('précision du tir');

    const enPrompt = buildSystemPromptForArtist(ARTIST_IDS.CATHY_GAUTHIER, 'on-jase', null, 'en-CA');
    expect(enPrompt).toContain('## ADAPTATION WITHOUT SYCOPHANCY');
    expect(enPrompt).toContain('No sycophancy about the user');
  });
});
