import { VISIBLE_MODE_IDS_BY_CATEGORY } from './experienceCatalog';
import type { ImageSourcePropType } from 'react-native';
import roastIcon from '../../assets/icons/GM_Roast.png';
import gadgetIcon from '../../assets/icons/GM_Gadget.png';
import gamesIcon from '../../assets/icons/GM_Games.png';
import profileIcon from '../../assets/icons/GM_Profile.png';

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
    icon: roastIcon,
    labelKey: 'modeCategoryDelire'
  },
  experiences: {
    emoji: '🧪',
    icon: gadgetIcon,
    labelKey: 'modeCategoryExperiences'
  },
  battles: {
    emoji: '⚔️',
    icon: gamesIcon,
    labelKey: 'modeCategoryBattles'
  },
  profile: {
    emoji: '👤',
    icon: profileIcon,
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
