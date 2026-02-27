import { ActivityIndicator, View } from 'react-native';
import { t } from '../../i18n';
import { theme } from '../../theme';

export function LoadingSpinner() {
  return (
    <View accessibilityLabel={t('loadingA11y')} testID="loading-spinner">
      <ActivityIndicator color={theme.colors.accent} accessibilityLabel={t('loadingA11y')} />
    </View>
  );
}
