import { memo } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import logoMark from '../../../assets/branding/logo-neon_app.png';
import logoMarkCompact from '../../../assets/branding/logo-neon_NoText_BIG.png';
import { theme } from '../../theme';

interface BrandMarkProps {
  compact?: boolean;
  title?: string;
}

function BrandMarkBase({ compact = false, title }: BrandMarkProps) {
  return (
    <View style={[styles.row, compact ? styles.rowCompact : styles.rowRegular]}>
      <Image source={compact ? logoMarkCompact : logoMark} style={compact ? styles.logoCompact : styles.logoRegular} resizeMode="contain" />
      {compact && title ? (
        <Text style={[styles.title, Platform.OS === 'web' ? styles.titleWeb : null]} numberOfLines={1}>
          {title}
        </Text>
      ) : null}
    </View>
  );
}

export const BrandMark = memo(BrandMarkBase);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  rowCompact: {
    gap: 10
  },
  rowRegular: {
    justifyContent: 'center'
  },
  logoCompact: {
    width: 42,
    aspectRatio: 1
  },
  logoRegular: {
    width: 132,
    height: 132,
    aspectRatio: 1
  },
  title: {
    marginLeft: 4,
    color: theme.colors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.2
  },
  titleWeb: {
    fontSize: 19
  }
});
