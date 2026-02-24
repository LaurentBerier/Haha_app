import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../../theme';

interface ArtistAvatarProps {
  initials: string;
  size?: number;
}

export function ArtistAvatar({ initials, size = 36 }: ArtistAvatarProps) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={styles.text}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    backgroundColor: theme.colors.artistBubble,
    borderWidth: 1,
    borderColor: theme.colors.border,
    justifyContent: 'center',
    alignItems: 'center'
  },
  text: {
    color: theme.colors.textPrimary,
    fontWeight: '700'
  }
});
