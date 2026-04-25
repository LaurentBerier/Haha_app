import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus, Platform } from 'react-native';

function readInitialVisibility(): boolean {
  if (Platform.OS === 'web') {
    if (typeof document === 'undefined') {
      return true;
    }
    return document.visibilityState !== 'hidden';
  }
  return AppState.currentState === 'active';
}

const listeners = new Set<(visible: boolean) => void>();
let currentVisible = readInitialVisibility();
let installed = false;

function emit(next: boolean) {
  if (next === currentVisible) {
    return;
  }
  currentVisible = next;
  listeners.forEach((fn) => fn(next));
}

function install() {
  if (installed) {
    return;
  }
  installed = true;

  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }
    const onVisibility = () => emit(document.visibilityState !== 'hidden');
    const onPageHide = () => emit(false);
    const onPageShow = () => emit(document.visibilityState !== 'hidden');
    const onFocus = () => emit(document.visibilityState !== 'hidden');
    const onBlur = () => {
      if (document.visibilityState === 'hidden') {
        emit(false);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return;
  }

  const onAppStateChange = (next: AppStateStatus) => emit(next === 'active');
  AppState.addEventListener('change', onAppStateChange);
}

export function isPageVisibleNow(): boolean {
  return currentVisible;
}

export function subscribePageVisible(fn: (visible: boolean) => void): () => void {
  install();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function usePageVisible(): boolean {
  const [visible, setVisible] = useState<boolean>(() => {
    install();
    return currentVisible;
  });

  useEffect(() => {
    return subscribePageVisible(setVisible);
  }, []);

  return visible;
}
