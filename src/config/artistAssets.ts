import type { ImageSourcePropType } from 'react-native';
import cathyAvatar from '../../CathyGauthier.jpg';
import { ARTIST_IDS } from './constants';

const ARTIST_AVATAR_SOURCES: Record<string, ImageSourcePropType> = {
  [ARTIST_IDS.CATHY_GAUTHIER]: cathyAvatar
};

export function getArtistAvatarSource(artistId: string): ImageSourcePropType | null {
  return ARTIST_AVATAR_SOURCES[artistId] ?? null;
}
