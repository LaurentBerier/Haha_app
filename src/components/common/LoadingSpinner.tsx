import { ActivityIndicator, View } from 'react-native';
import { theme } from '../../theme';

export function LoadingSpinner() {
  return (
    <View>
      <ActivityIndicator color={theme.colors.accent} />
    </View>
  );
}
