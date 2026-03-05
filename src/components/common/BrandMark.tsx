import { memo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import logoFull from '../../../assets/branding/logo-neon.png';
import logoIcon from '../../../assets/branding/logo-neon-icon.png';
import { theme } from '../../theme';

interface BrandMarkProps {
  compact?: boolean;
  title?: string;
}

function BrandMarkBase({ compact = false, title }: BrandMarkProps) {
  return (
    <View style={[styles.row, compact ? styles.rowCompact : styles.rowRegular]}>
      {compact ? (
        <>
          <Image source={logoIcon} style={styles.logoCompact} resizeMode="cover" />
          {title ? (
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
          ) : null}
        </>
      ) : (
        <Image source={logoFull} style={styles.logoRegular} resizeMode="contain" />
      )}
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
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border
  },
  logoRegular: {
    width: '100%',
    maxWidth: 320,
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
