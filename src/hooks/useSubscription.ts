import { useStore } from '../store/useStore';

export function useSubscription() {
  const subscription = useStore((state) => state.subscription);
  const canAccessFeature = useStore((state) => state.canAccessFeature);

  return {
    subscription,
    canAccessFeature
  };
}
