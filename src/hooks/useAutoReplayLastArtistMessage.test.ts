jest.mock('react-native', () => ({
  AppState: {
    addEventListener: jest.fn(() => ({
      remove: jest.fn()
    }))
  },
  Platform: {
    OS: 'web'
  }
}));

import { shouldReplayOnFocusLifecycle } from './useAutoReplayLastArtistMessage';

describe('useAutoReplayLastArtistMessage helpers', () => {
  it('disables focus replay when replayOnFocus is false', () => {
    expect(shouldReplayOnFocusLifecycle(true, false, true)).toBe(false);
  });

  it('disables focus replay when voice auto-play is off', () => {
    expect(shouldReplayOnFocusLifecycle(true, true, false)).toBe(false);
  });

  it('enables focus replay only when hook is enabled and replayOnFocus is true', () => {
    expect(shouldReplayOnFocusLifecycle(true, true, true)).toBe(true);
    expect(shouldReplayOnFocusLifecycle(false, true, true)).toBe(false);
  });
});
