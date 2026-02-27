import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Artist } from '../../models/Artist';
import { theme } from '../../theme';
import { t } from '../../i18n';
import { getArtistAvatarSource } from '../../config/artistAssets';
import { PremiumBadge } from '../common/PremiumBadge';
import { ArtistAvatar } from './ArtistAvatar';

interface ArtistCardProps {
  artist: Artist;
  locked: boolean;
  onStart: () => void;
}

export function ArtistCard({ artist, locked, onStart }: ArtistCardProps) {
  const avatarSource = getArtistAvatarSource(artist.id);
  const artistGenre = artist.id === 'cathy-gauthier' ? t('artistGenreCathy') : '';

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && !locked && styles.pressed, locked && styles.locked]}
      testID={`artist-start-${artist.id}`}
      accessibilityRole="button"
      onPress={onStart}
      disabled={locked}
    >
      <View style={styles.avatarWrap}>
        <ArtistAvatar label={artist.name} source={avatarSource} size={138} />
        {artist.isPremium ? (
          <View style={styles.badgeWrap}>
            <PremiumBadge />
          </View>
        ) : null}
      </View>
      <View style={styles.labelWrap}>
        <Text style={styles.name}>{artist.name}</Text>
        {artistGenre ? <Text style={styles.genre}>{artistGenre}</Text> : null}
        {locked ? <Text style={styles.lockedLabel}>{t('locked')}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    alignItems: 'center',
    backgroundColor: '#121826',
    borderWidth: 1,
    borderColor: '#273248',
    borderRadius: 20,
    paddingVertical: theme.spacing.lg,
    paddingHorizontal: theme.spacing.md,
    gap: theme.spacing.sm,
    shadowColor: '#6C86FF',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3
  },
  pressed: {
    transform: [{ scale: 0.985 }],
    opacity: 0.94
  },
  locked: {
    opacity: 0.55
  },
  avatarWrap: {
    position: 'relative'
  },
  badgeWrap: {
    position: 'absolute',
    bottom: -4,
    right: -4
  },
  labelWrap: {
    alignItems: 'center',
    gap: 1
  },
  name: {
    color: theme.colors.textPrimary,
    fontSize: 19,
    fontWeight: '700'
  },
  genre: {
    color: theme.colors.textMuted,
    fontSize: 12
  },
  lockedLabel: {
    color: theme.colors.error,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4
  }
});
