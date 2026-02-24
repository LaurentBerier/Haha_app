import { useRef } from 'react';

export function useStreamingMessage() {
  const cancelRef = useRef<null | (() => void)>(null);

  const setCancel = (cb: () => void) => {
    cancelRef.current = cb;
  };

  const cancel = () => {
    cancelRef.current?.();
    cancelRef.current = null;
  };

  return { setCancel, cancel };
}
