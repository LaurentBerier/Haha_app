import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { useStorePersistence } from '../hooks/useStorePersistence';
import { theme } from '../theme';
import { t } from '../i18n';
import { useStore } from '../store/useStore';

export default function RootLayout() {
  useStorePersistence();
  const hasHydrated = useStore((state) => state.hasHydrated);

  if (!hasHydrated) {
    return (
      <View style={styles.loadingScreen}>
        <LoadingSpinner />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.colors.background },
          headerTintColor: theme.colors.textPrimary,
          contentStyle: { backgroundColor: theme.colors.background }
        }}
      >
        <Stack.Screen name="index" options={{ title: t('appName') }} />
        <Stack.Screen name="chat/[conversationId]" options={{ title: t('chatTitle') }} />
        <Stack.Screen name="settings/index" options={{ title: t('settingsTitle') }} />
      </Stack>
    </>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    backgroundColor: theme.colors.background,
    justifyContent: 'center',
    alignItems: 'center'
  }
});
