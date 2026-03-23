import { useEffect } from 'react';
import { router } from 'expo-router';

interface UseLayoutAuthGateOptions {
  hasHydrated: boolean;
  authStatus: 'loading' | 'authenticated' | 'unauthenticated';
  isAuthenticated: boolean;
  inAuthGroup: boolean;
  isAuthCallbackRoute: boolean;
  isOnboardingRoute: boolean;
  needsOnboarding: boolean;
  e2eAuthBypass: boolean;
}

export function useLayoutAuthGate({
  hasHydrated,
  authStatus,
  isAuthenticated,
  inAuthGroup,
  isAuthCallbackRoute,
  isOnboardingRoute,
  needsOnboarding,
  e2eAuthBypass
}: UseLayoutAuthGateOptions): void {
  useEffect(() => {
    if (!hasHydrated || authStatus === 'loading') {
      return;
    }

    if (!isAuthenticated) {
      if (e2eAuthBypass) {
        if (inAuthGroup) {
          router.replace('/');
        }
        return;
      }

      if ((!inAuthGroup && !isAuthCallbackRoute) || isOnboardingRoute) {
        router.replace('/(auth)/login');
      }
      return;
    }

    if (needsOnboarding && !isOnboardingRoute) {
      router.replace('/(auth)/onboarding');
      return;
    }

    if (!needsOnboarding && inAuthGroup) {
      router.replace('/');
    }
  }, [
    authStatus,
    e2eAuthBypass,
    hasHydrated,
    inAuthGroup,
    isAuthCallbackRoute,
    isAuthenticated,
    isOnboardingRoute,
    needsOnboarding
  ]);
}
