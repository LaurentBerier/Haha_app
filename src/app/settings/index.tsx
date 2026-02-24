import { StyleSheet, Text, View } from 'react-native';
import { Header } from '../../components/common/Header';
import { t } from '../../i18n';
import { theme } from '../../theme';

export default function SettingsScreen() {
  return (
    <View style={styles.screen}>
      <Header title={t('settingsTitle')} subtitle={t('appName')} />
      <Text style={styles.body}>{t('settingsPhase')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
    padding: theme.spacing.lg
  },
  body: {
    color: theme.colors.textPrimary
  }
});
