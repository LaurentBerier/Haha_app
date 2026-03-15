import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ARTIST_IDS } from '../../config/constants';
import type { Artist } from '../../models/Artist';
import { theme } from '../../theme';
import { t } from '../../i18n';
import { getArtistAvatarSource } from '../../config/artistAssets';
import { impactLight } from '../../services/hapticsService';
import { ArtistAvatar } from './ArtistAvatar';

interface ArtistCardProps {
  artist: Artist;
  locked: boolean;
  onStart: () => void;
}

export function ArtistCard({ artist, locked, onStart }: ArtistCardProps) {
  const avatarSource = getArtistAvatarSource(artist.id);
  const artistGenre = artist.id === ARTIST_IDS.CATHY_GAUTHIER ? t('artistGenreCathy') : '';
  const ctaLabel = artist.id === ARTIST_IDS.CATHY_GAUTHIER ? t('artistTalkWithCathy') : t('startChat');
  const availabilityLabel = t('artistComingSoonCardText');

  const handleStart = () => {
    void impactLight();
    onStart();
  };

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        pressed && !locked && styles.pressed,
        locked && styles.locked
      ]}
      testID={`artist-start-${artist.id}`}
      accessibilityRole="button"
      accessibilityLabel={locked ? `${artist.name} ${availabilityLabel}` : `${ctaLabel}`}
      onPress={handleStart}
      disabled={locked}
    >
      <View style={styles.avatarWrap}>
        <ArtistAvatar label={artist.name} source={avatarSource} size={124} showComedianPlaceholder={locked} />
        {locked ? <View style={styles.badgeSoon}><Text style={styles.badgeSoonLabel}>{t('artistComingSoonBadge')}</Text></View> : null}
      </View>
      <View style={styles.labelWrap}>
        <Text style={styles.name}>{artist.name}</Text>
        {artistGenre ? <Text style={styles.genre}>{artistGenre}</Text> : null}
        {locked ? <Text style={styles.comingSoonText}>{availabilityLabel}</Text> : null}
        {!locked ? (
          <View style={styles.ctaPill}>
            <Text style={styles.ctaLabel}>{ctaLabel}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: 608,
    alignSelf: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceRaised,
    borderWidth: 1.9,
    borderColor: theme.colors.neonRedSoft,
    borderRadius: 18,
    paddingVertical: theme.spacing.lg,
    paddingHorizontal: theme.spacing.md,
    gap: theme.spacing.sm,
    shadowColor: theme.colors.neonRed,
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6
  },
  pressed: {
    transform: [{ scale: 0.985 }],
    opacity: 0.94
  },
  hovered: {
    borderColor: theme.colors.neonBlue,
    shadowOpacity: 0.4
  },
  locked: {
    opacity: 0.86
  },
  avatarWrap: {
    position: 'relative'
  },
  badgeSoon: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSunken,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4
  },
  badgeSoonLabel: {
    color: theme.colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  labelWrap: {
    alignItems: 'center',
    gap: 4
  },
  name: {
    color: theme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '700'
  },
  genre: {
    color: theme.colors.textMuted,
    fontSize: 12
  },
  comingSoonText: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '600'
  },
  ctaPill: {
    marginTop: 2,
    borderRadius: 999,
    borderWidth: 1.9,
    borderColor: theme.colors.neonBlue,
    backgroundColor: theme.colors.surfaceSunken,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
    shadowColor: theme.colors.neonBlue,
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 5
  },
  ctaLabel: {
    color: theme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '700'
  }
});
