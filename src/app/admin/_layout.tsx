import { Stack, router } from 'expo-router';
import { useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';

export default function AdminLayout() {
  const { isAdmin, authStatus } = useAuth();

  useEffect(() => {
    if (authStatus === 'loading') {
      return;
    }
    if (!isAdmin) {
      router.replace('/settings');
    }
  }, [isAdmin, authStatus]);

  if (!isAdmin) {
    return null;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ title: 'Admin Dashboard' }} />
      <Stack.Screen name="users" options={{ title: 'Users' }} />
    </Stack>
  );
}
