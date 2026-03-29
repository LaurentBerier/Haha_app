import { ARTIST_IDS } from '../config/constants';
import { getLaunchableExperiencesForArtist } from '../config/experienceCatalog';
import { resolveExperienceLaunchIntent } from './experienceLaunchIntent';

describe('experienceLaunchIntent', () => {
  const experiences = getLaunchableExperiencesForArtist(ARTIST_IDS.CATHY_GAUTHIER);

  it('detects a direct French mode launch command', () => {
    const result = resolveExperienceLaunchIntent('Lance le mode Dis-moi la verite maintenant.', experiences);

    expect(result).not.toBeNull();
    expect(result?.experience.type).toBe('mode');
    expect(result?.experience.id).toBe('on-jase');
    expect(result?.reason).toBe('direct_command');
  });

  it('detects an English direct game launch command', () => {
    const result = resolveExperienceLaunchIntent('Please launch Tarot Reading game.', experiences);

    expect(result).not.toBeNull();
    expect(result?.experience.type).toBe('game');
    expect(result?.experience.id).toBe('tarot-cathy');
    expect(result?.reason).toBe('direct_command');
  });

  it('detects a game request with play intent', () => {
    const result = resolveExperienceLaunchIntent('Je veux jouer a impro.', experiences);

    expect(result).not.toBeNull();
    expect(result?.experience.type).toBe('game');
    expect(result?.experience.id).toBe('impro-chain');
    expect(result?.reason).toBe('game_play_request');
  });

  it('does not launch when multiple experiences are matched', () => {
    const result = resolveExperienceLaunchIntent('Lance impro et tarot.', experiences);

    expect(result).toBeNull();
  });

  it('does not launch when user only mentions an experience without intent', () => {
    const result = resolveExperienceLaunchIntent('Le tarot me fait rire.', experiences);

    expect(result).toBeNull();
  });
});
