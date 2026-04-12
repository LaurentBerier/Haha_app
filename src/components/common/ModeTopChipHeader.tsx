import { Image, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import { BackButton } from './BackButton';
import { theme } from '../../theme';

interface ModeTopChipHeaderProps {
  title: string;
  subtitle?: string;
  iconSource?: ImageSourcePropType | null;
  iconEmoji?: string | null;
  horizontalInset: number;
  backTestID?: string;
  onBackPress?: () => void;
  chipTestID?: string;
}

export function ModeTopChipHeader({
  title,
  subtitle,
  iconSource,
  iconEmoji,
  horizontalInset,
  backTestID = 'mode-top-chip-back',
  onBackPress,
  chipTestID = 'mode-top-chip'
}: ModeTopChipHeaderProps) {
  const normalizedTitle = title.trim();
  const normalizedSubtitle = subtitle?.trim() ?? '';

  return (
    <View>
      <View
        style={[
          styles.topRow,
          { paddingHorizontal: horizontalInset },
          normalizedSubtitle ? styles.topRowCompactBottom : null
        ]}
      >
        <BackButton testID={backTestID} onPress={onBackPress} />
        {normalizedTitle ? (
          <View pointerEvents="none" style={styles.centerWrap}>
            <View style={styles.chip} testID={chipTestID}>
              {iconSource ? (
                <Image source={iconSource} style={styles.iconImage} resizeMode="contain" />
              ) : (
                <Text style={styles.iconEmoji}>{iconEmoji?.trim() || '💬'}</Text>
              )}
              <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">
                {normalizedTitle}
              </Text>
            </View>
          </View>
        ) : null}
      </View>
      {normalizedSubtitle ? (
        <View style={[styles.subtitleRow, { paddingHorizontal: horizontalInset }]}>
          <Text style={styles.subtitle} numberOfLines={2}>
            {normalizedSubtitle}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  topRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'flex-start',
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.sm
  },
  topRowCompactBottom: {
    paddingBottom: theme.spacing.xs
  },
  centerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0
  },
  chip: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.spacing.xs,
    minHeight: 44,
    maxWidth: '74%',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 4
  },
  iconImage: {
    height: 34,
    width: 34
  },
  iconEmoji: {
    fontSize: 26,
    lineHeight: 30
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: 20,
    fontWeight: '800',
    flexShrink: 1
  },
  subtitleRow: {
    alignItems: 'center',
    paddingBottom: theme.spacing.xs
  },
  subtitle: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 16,
    maxWidth: 560
  }
});
