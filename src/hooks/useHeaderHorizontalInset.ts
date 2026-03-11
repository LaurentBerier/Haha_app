import { Platform, useWindowDimensions } from 'react-native';
import { theme } from '../theme';

const DEFAULT_HEADER_CONTENT_MAX_WIDTH = 680;

export function useHeaderHorizontalInset(contentMaxWidth = DEFAULT_HEADER_CONTENT_MAX_WIDTH): number {
  const { width: viewportWidth } = useWindowDimensions();

  if (Platform.OS !== 'web') {
    return theme.spacing.md;
  }

  return Math.max(theme.spacing.md, (viewportWidth - contentMaxWidth) / 2 + theme.spacing.md);
}
