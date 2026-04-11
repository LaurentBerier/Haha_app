import { VISIBLE_MODE_IDS_BY_CATEGORY } from './experienceCatalog';
import type { ImageSourcePropType } from 'react-native';

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
    icon: ImageSourcePropType;
    labelKey: ModeCategoryLabelKey;
  }
> = {
  delire: {
    emoji: '🤪',
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    icon: require('../../assets/icons/GM_Roast2.png'),
    labelKey: 'modeCategoryDelire'
  },
  experiences: {
    emoji: '🧪',
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    icon: require('../../assets/icons/GM_Gadget.png'),
    labelKey: 'modeCategoryExperiences'
  },
  battles: {
    emoji: '⚔️',
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    icon: require('../../assets/icons/GM_Games.png'),
    labelKey: 'modeCategoryBattles'
  },
  profile: {
    emoji: '👤',
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    icon: require('../../assets/icons/GM_Profile.png'),
    labelKey: 'modeCategoryProfile'
  }
};

export const CATEGORY_MODE_IDS: Record<Exclude<ModeCategoryId, 'profile'>, string[]> = {
  delire: [...VISIBLE_MODE_IDS_BY_CATEGORY.delire],
  experiences: [...VISIBLE_MODE_IDS_BY_CATEGORY.experiences],
  battles: []
};

export function isModeCategoryId(value: string): value is ModeCategoryId {
  return MODE_CATEGORY_ORDER.includes(value as ModeCategoryId);
}
