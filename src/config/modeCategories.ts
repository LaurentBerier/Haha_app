import { MODE_IDS } from './constants';

export type ModeCategoryId = 'delire' | 'experiences' | 'battles' | 'profile';
type ModeCategoryLabelKey =
  | 'modeCategoryDelire'
  | 'modeCategoryExperiences'
  | 'modeCategoryBattles'
  | 'modeCategoryProfile';

export const MODE_CATEGORY_ORDER: ModeCategoryId[] = ['delire', 'experiences', 'battles', 'profile'];

export const MODE_CATEGORY_META: Record<
  ModeCategoryId,
  {
    emoji: string;
    labelKey: ModeCategoryLabelKey;
  }
> = {
  delire: { emoji: '🤪', labelKey: 'modeCategoryDelire' },
  experiences: { emoji: '🧪', labelKey: 'modeCategoryExperiences' },
  battles: { emoji: '⚔️', labelKey: 'modeCategoryBattles' },
  profile: { emoji: '👤', labelKey: 'modeCategoryProfile' }
};

export const CATEGORY_MODE_IDS: Record<Exclude<ModeCategoryId, 'profile'>, string[]> = {
  delire: [MODE_IDS.ON_JASE, MODE_IDS.GRILL],
  experiences: [
    MODE_IDS.MEME_GENERATOR,
    MODE_IDS.SCREENSHOT_ANALYZER,
    MODE_IDS.VICTIME_DU_JOUR,
    MODE_IDS.PHRASE_DU_JOUR,
    MODE_IDS.NUMERO_DE_SHOW
  ],
  battles: []
};

export function isModeCategoryId(value: string): value is ModeCategoryId {
  return MODE_CATEGORY_ORDER.includes(value as ModeCategoryId);
}
