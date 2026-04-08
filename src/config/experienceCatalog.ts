import { ARTIST_IDS, MODE_IDS } from './constants';
import type { GameType } from '../games/types';

export type LaunchableExperienceType = 'mode' | 'game';

export interface LaunchableExperienceDefinition {
  id: string;
  type: LaunchableExperienceType;
  modeId?: string;
  gameId?: GameType;
  nameFr: string;
  nameEn: string;
  aliases: string[];
  ctaFr: string[];
  ctaEn: string[];
}

export interface AvailableExperiencePromptDescriptor {
  id: string;
  type: LaunchableExperienceType;
  name: string;
  aliases: string[];
  ctaExamples: string[];
}

export const VISIBLE_MODE_IDS_BY_CATEGORY = {
  delire: [MODE_IDS.ON_JASE, MODE_IDS.GRILL],
  experiences: [MODE_IDS.MEME_GENERATOR, MODE_IDS.SCREENSHOT_ANALYZER, MODE_IDS.NUMERO_DE_SHOW]
} as const;

export const VISIBLE_CONVERSATION_MODE_IDS: string[] = [
  ...VISIBLE_MODE_IDS_BY_CATEGORY.delire,
  ...VISIBLE_MODE_IDS_BY_CATEGORY.experiences
];

export const VISIBLE_GAME_IDS: GameType[] = ['impro-chain', 'vrai-ou-invente', 'tarot-cathy'];

const CATHY_VISIBLE_EXPERIENCES: LaunchableExperienceDefinition[] = [
  {
    id: MODE_IDS.ON_JASE,
    type: 'mode',
    modeId: MODE_IDS.ON_JASE,
    nameFr: 'Dis-moi la vérité',
    nameEn: 'Tell me the truth',
    aliases: [
      'dis-moi la vérité',
      'dis-moi la verite',
      'dis moi la verite',
      'on jase',
      'mode verite',
      'truth mode'
    ],
    ctaFr: ['Lance le mode Dis-moi la vérité'],
    ctaEn: ['Launch Tell me the truth mode']
  },
  {
    id: MODE_IDS.GRILL,
    type: 'mode',
    modeId: MODE_IDS.GRILL,
    nameFr: 'Mets-moi sur le grill',
    nameEn: 'Put me on the grill',
    aliases: ['mets-moi sur le grill', 'mets moi sur le grill', 'sur le grill', 'mode grill', 'grill mode'],
    ctaFr: ['Lance le mode Mets-moi sur le grill'],
    ctaEn: ['Launch Put me on the grill mode']
  },
  {
    id: MODE_IDS.MEME_GENERATOR,
    type: 'mode',
    modeId: MODE_IDS.MEME_GENERATOR,
    nameFr: 'Générateur de Meme',
    nameEn: 'Meme Generator',
    aliases: ['générateur de meme', 'generateur de meme', 'meme generator', 'mode meme', 'meme mode'],
    ctaFr: ['Lance le mode Générateur de Meme'],
    ctaEn: ['Launch Meme Generator mode']
  },
  {
    id: MODE_IDS.SCREENSHOT_ANALYZER,
    type: 'mode',
    modeId: MODE_IDS.SCREENSHOT_ANALYZER,
    nameFr: 'Jugement de Texto',
    nameEn: 'Text Judgment',
    aliases: ['jugement de texto', 'texto', 'screenshot analyzer', 'text judgment', 'mode texto'],
    ctaFr: ['Lance le mode Jugement de Texto'],
    ctaEn: ['Launch Text Judgment mode']
  },
  {
    id: MODE_IDS.NUMERO_DE_SHOW,
    type: 'mode',
    modeId: MODE_IDS.NUMERO_DE_SHOW,
    nameFr: 'Numéro de show',
    nameEn: 'Show number',
    aliases: ['numéro de show', 'numero de show', 'mini show', 'standup', 'stand-up', 'mode show'],
    ctaFr: ['Lance le mode Numéro de show'],
    ctaEn: ['Launch Show number mode']
  },
  {
    id: 'impro-chain',
    type: 'game',
    gameId: 'impro-chain',
    nameFr: 'Impro',
    nameEn: 'Impro',
    aliases: ['impro', 'jeu impro', 'improv', 'improv game'],
    ctaFr: ['Lance le jeu Impro'],
    ctaEn: ['Launch Impro game']
  },
  {
    id: 'vrai-ou-invente',
    type: 'game',
    gameId: 'vrai-ou-invente',
    nameFr: 'Vrai ou Inventé',
    nameEn: 'True or Invented',
    aliases: ['vrai ou inventé', 'vrai ou invente', 'vrai ou invente?', 'true or invented', '2 vraies 1 inventee'],
    ctaFr: ['Lance le jeu Vrai ou Inventé'],
    ctaEn: ['Launch True or Invented game']
  },
  {
    id: 'tarot-cathy',
    type: 'game',
    gameId: 'tarot-cathy',
    nameFr: 'Tirage de Tarot',
    nameEn: 'Tarot Reading',
    aliases: ['tirage de tarot', 'tarot', 'tarot cathy', 'tarot reading'],
    ctaFr: ['Lance le jeu Tirage de Tarot'],
    ctaEn: ['Launch Tarot Reading game']
  }
];

function isEnglish(language: string): boolean {
  return typeof language === 'string' && language.trim().toLowerCase().startsWith('en');
}

function getCathyVisibleExperiences(): LaunchableExperienceDefinition[] {
  return CATHY_VISIBLE_EXPERIENCES;
}

export function getLaunchableExperiencesForArtist(artistId: string): LaunchableExperienceDefinition[] {
  if (artistId !== ARTIST_IDS.CATHY_GAUTHIER) {
    return [];
  }

  return getCathyVisibleExperiences();
}

export function getLaunchableExperienceByModeId(
  artistId: string,
  modeId: string
): LaunchableExperienceDefinition | null {
  const normalizedModeId = typeof modeId === 'string' ? modeId.trim() : '';
  if (!normalizedModeId) {
    return null;
  }

  return (
    getLaunchableExperiencesForArtist(artistId).find((entry) => entry.type === 'mode' && entry.modeId === normalizedModeId) ?? null
  );
}

export function getLaunchableExperienceByGameId(
  artistId: string,
  gameId: GameType
): LaunchableExperienceDefinition | null {
  return (
    getLaunchableExperiencesForArtist(artistId).find((entry) => entry.type === 'game' && entry.gameId === gameId) ?? null
  );
}

export function buildAvailableExperiencesForPrompt(
  artistId: string,
  language: string
): AvailableExperiencePromptDescriptor[] {
  const useEnglish = isEnglish(language);

  return getLaunchableExperiencesForArtist(artistId).map((entry) => ({
    id: entry.id,
    type: entry.type,
    name: useEnglish ? entry.nameEn : entry.nameFr,
    aliases: [...entry.aliases].slice(0, 8),
    ctaExamples: (useEnglish ? entry.ctaEn : entry.ctaFr).slice(0, 3)
  }));
}

export function getVisibleModeNamesForGreeting(artistId: string, language: string): string[] {
  const useEnglish = isEnglish(language);

  return getLaunchableExperiencesForArtist(artistId)
    .filter((entry) => entry.type === 'mode')
    .map((entry) => (useEnglish ? entry.nameEn : entry.nameFr));
}
