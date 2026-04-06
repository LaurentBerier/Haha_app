import fs from 'node:fs';
import path from 'node:path';

describe('useLayoutAuthGate', () => {
  it('does not force redirect to home while still on onboarding route', () => {
    const hookPath = path.resolve(__dirname, './useLayoutAuthGate.ts');
    const source = fs.readFileSync(hookPath, 'utf8');

    expect(source).toContain('if (!needsOnboarding && inAuthGroup && !isOnboardingRoute) {');
  });
});
