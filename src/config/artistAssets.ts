import type { ImageSourcePropType } from 'react-native';
import cathyAvatar from '../../CathyGauthier.jpg';

const ARTIST_AVATAR_SOURCES: Record<string, ImageSourcePropType> = {
  'cathy-gauthier': cathyAvatar
};

export function getArtistAvatarSource(artistId: string): ImageSourcePropType | null {
  return ARTIST_AVATAR_SOURCES[artistId] ?? null;
}
