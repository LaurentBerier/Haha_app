import { shouldRestoreModeSelectMicAfterBlur } from '../app/mode-select/micRestore';

describe('modeSelect mic restore', () => {
  it('restores when conversation mode is enabled and mic was active', () => {
    expect(shouldRestoreModeSelectMicAfterBlur(true, 'listening')).toBe(true);
    expect(shouldRestoreModeSelectMicAfterBlur(true, 'assistant_busy')).toBe(true);
    expect(shouldRestoreModeSelectMicAfterBlur(true, 'recovering')).toBe(true);
    expect(shouldRestoreModeSelectMicAfterBlur(true, 'starting')).toBe(true);
  });

  it('does not restore when conversation mode is disabled', () => {
    expect(shouldRestoreModeSelectMicAfterBlur(false, 'listening')).toBe(false);
  });

  it('does not restore from non-active mic states', () => {
    expect(shouldRestoreModeSelectMicAfterBlur(true, 'off')).toBe(false);
    expect(shouldRestoreModeSelectMicAfterBlur(true, 'paused_manual')).toBe(false);
    expect(shouldRestoreModeSelectMicAfterBlur(true, 'paused_recovery')).toBe(false);
    expect(shouldRestoreModeSelectMicAfterBlur(true, 'unsupported')).toBe(false);
    expect(shouldRestoreModeSelectMicAfterBlur(true, 'error')).toBe(false);
  });
});
