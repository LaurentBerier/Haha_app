jest.mock('react-native', () => ({
  Alert: {
    alert: jest.fn()
  },
  Platform: {
    OS: 'ios'
  }
}));

const { requestGameExitConfirmation, shouldGuardGameExit } = require('./useGameExitGuard');

describe('useGameExitGuard helpers', () => {
  it('guards only active game statuses', () => {
    expect(shouldGuardGameExit(null)).toBe(false);
    expect(shouldGuardGameExit(undefined)).toBe(false);
    expect(shouldGuardGameExit('complete')).toBe(false);
    expect(shouldGuardGameExit('abandoned')).toBe(false);
    expect(shouldGuardGameExit('loading')).toBe(true);
    expect(shouldGuardGameExit('active')).toBe(true);
    expect(shouldGuardGameExit('reading')).toBe(true);
  });

  it('runs web confirmation and confirms navigation when accepted', () => {
    const onConfirm = jest.fn();
    const confirmWeb = jest.fn(() => true);

    requestGameExitConfirmation({
      platformOS: 'web',
      title: 'Quitter',
      message: 'Partie en cours',
      confirmLabel: 'Quitter',
      cancelLabel: 'Annuler',
      onConfirm,
      confirmWeb
    });

    expect(confirmWeb).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('does not confirm navigation when web confirmation is rejected', () => {
    const onConfirm = jest.fn();
    const confirmWeb = jest.fn(() => false);

    requestGameExitConfirmation({
      platformOS: 'web',
      title: 'Quitter',
      message: 'Partie en cours',
      confirmLabel: 'Quitter',
      cancelLabel: 'Annuler',
      onConfirm,
      confirmWeb
    });

    expect(confirmWeb).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('uses native alert branch and triggers onConfirm from destructive action', () => {
    const onConfirm = jest.fn();
    const showNativeAlert = jest.fn();

    requestGameExitConfirmation({
      platformOS: 'ios',
      title: 'Quitter',
      message: 'Partie en cours',
      confirmLabel: 'Quitter',
      cancelLabel: 'Annuler',
      onConfirm,
      showNativeAlert: showNativeAlert as any
    });

    expect(showNativeAlert).toHaveBeenCalledTimes(1);
    const buttons = showNativeAlert.mock.calls[0]?.[2] as Array<{ onPress?: () => void }> | undefined;
    buttons?.[1]?.onPress?.();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
