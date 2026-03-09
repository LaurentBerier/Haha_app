import { Image, type ImageSourcePropType, StyleSheet, Text, View } from 'react-native';
import { theme } from '../../theme';

interface ArtistAvatarProps {
  label: string;
  size?: number;
  source?: ImageSourcePropType | null;
  showComedianPlaceholder?: boolean;
}

export function ArtistAvatar({
  label,
  size = 36,
  source = null,
  showComedianPlaceholder = false
}: ArtistAvatarProps) {
  const borderRadius = size / 2;

  return (
    <View style={[styles.outer, { width: size + 8, height: size + 8, borderRadius: borderRadius + 4 }]}>
      <View style={[styles.avatar, { width: size, height: size, borderRadius }]}>
        {source ? (
          <Image source={source} style={styles.image} resizeMode="cover" />
        ) : showComedianPlaceholder ? (
          <View style={styles.comedianPlaceholder} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={styles.comedianHead} />
            <View style={styles.comedianBody} />
          </View>
        ) : (
          <Text style={[styles.text, { fontSize: Math.max(13, Math.floor(size * 0.34)) }]}>{label}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.artistBubble,
    justifyContent: 'center',
    alignItems: 'center'
  },
  avatar: {
    backgroundColor: theme.colors.artistBubble,
    borderWidth: 1,
    borderColor: theme.colors.border,
    justifyContent: 'center',
    overflow: 'hidden'
  },
  image: {
    width: '100%',
    height: '100%'
  },
  comedianPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4
  },
  comedianHead: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#C9D3E7',
    backgroundColor: '#E8EEF9'
  },
  comedianBody: {
    width: 52,
    height: 30,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    borderWidth: 1,
    borderColor: '#C9D3E7',
    backgroundColor: '#E8EEF9'
  },
  text: {
    color: theme.colors.textPrimary,
    fontWeight: '700',
    textAlign: 'center'
  }
});
