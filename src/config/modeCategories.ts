import { VISIBLE_MODE_IDS_BY_CATEGORY } from './experienceCatalog';

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
  delire: [...VISIBLE_MODE_IDS_BY_CATEGORY.delire],
  experiences: [...VISIBLE_MODE_IDS_BY_CATEGORY.experiences],
  battles: []
};

export function isModeCategoryId(value: string): value is ModeCategoryId {
  return MODE_CATEGORY_ORDER.includes(value as ModeCategoryId);
}
