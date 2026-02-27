import { Image, type ImageSourcePropType, StyleSheet, Text, View } from 'react-native';
import { theme } from '../../theme';

interface ArtistAvatarProps {
  label: string;
  size?: number;
  source?: ImageSourcePropType | null;
}

export function ArtistAvatar({ label, size = 36, source = null }: ArtistAvatarProps) {
  const borderRadius = size / 2;

  return (
    <View style={[styles.outer, { width: size + 8, height: size + 8, borderRadius: borderRadius + 4 }]}>
      <View style={[styles.avatar, { width: size, height: size, borderRadius }]}>
        {source ? (
          <Image source={source} style={styles.image} resizeMode="cover" />
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
    borderColor: '#2c364d',
    backgroundColor: '#1a2233',
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
  text: {
    color: theme.colors.textPrimary,
    fontWeight: '700',
    textAlign: 'center'
  }
});
