import { memo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import logoMark from '../../../assets/branding/logo-neon_NoText_BIG.png';
import { theme } from '../../theme';

interface BrandMarkProps {
  compact?: boolean;
  title?: string;
}

function BrandMarkBase({ compact = false, title }: BrandMarkProps) {
  return (
    <View style={[styles.row, compact ? styles.rowCompact : styles.rowRegular]}>
      <Image source={logoMark} style={compact ? styles.logoCompact : styles.logoRegular} resizeMode="contain" />
      {compact && title ? (
        <Text style={styles.title} numberOfLines={1}>
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
    gap: 7
  },
  rowRegular: {
    justifyContent: 'center'
  },
  logoCompact: {
    width: 30,
    height: 30
  },
  logoRegular: {
    width: 132,
    height: 132,
    aspectRatio: 1
  },
  title: {
    marginLeft: 4,
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase'
  }
});
