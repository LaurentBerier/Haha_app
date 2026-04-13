import fs from 'node:fs';
import path from 'node:path';

describe('auth callback warm-start handling', () => {
  it('subscribes to Linking URL events while callback screen is mounted', () => {
    const screenPath = path.resolve(__dirname, './callback.tsx');
    const source = fs.readFileSync(screenPath, 'utf8');

    expect(source).toContain("Linking.addEventListener('url'");
    expect(source).toContain('void resolveCallback(url ?? null)');
  });

  it('checks duplicate callback URLs before clearing visible error state', () => {
    const screenPath = path.resolve(__dirname, './callback.tsx');
    const source = fs.readFileSync(screenPath, 'utf8');

    const duplicateGuardIndex = source.indexOf('if (callbackUrl && lastHandledUrlRef.current === callbackUrl)');
    const clearErrorIndex = source.indexOf('setErrorMessage(null);');

    expect(duplicateGuardIndex).toBeGreaterThan(-1);
    expect(clearErrorIndex).toBeGreaterThan(-1);
    expect(duplicateGuardIndex).toBeLessThan(clearErrorIndex);
  });
});
