import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Artist } from '../../models/Artist';
import { theme } from '../../theme';
import { t } from '../../i18n';
import { Button } from '../common/Button';
import { PremiumBadge } from '../common/PremiumBadge';
import { ArtistAvatar } from './ArtistAvatar';

interface ArtistCardProps {
  artist: Artist;
  locked: boolean;
  onStart: () => void;
}

export function ArtistCard({ artist, locked, onStart }: ArtistCardProps) {
  return (
    <Pressable style={styles.card} testID={`artist-card-${artist.id}`}>
      <View style={styles.headerRow}>
        <ArtistAvatar initials={artist.avatarUrl} size={48} />
        <View style={styles.titleWrap}>
          <Text style={styles.name}>{artist.name}</Text>
          <Text style={styles.meta}>{artist.supportedLanguages.join(' | ')}</Text>
        </View>
        {artist.isPremium ? <PremiumBadge /> : null}
      </View>
      <Button
        label={locked ? t('locked') : t('startChat')}
        onPress={onStart}
        disabled={locked}
        testID={`artist-start-${artist.id}`}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    padding: theme.spacing.lg,
    gap: theme.spacing.md
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md
  },
  titleWrap: {
    flex: 1
  },
  name: {
    color: theme.colors.textPrimary,
    fontSize: 18,
    fontWeight: '700'
  },
  meta: {
    color: theme.colors.textMuted,
    fontSize: 12
  }
});
