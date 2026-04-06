import fs from 'node:fs';
import path from 'node:path';

describe('onboarding subscription redirect', () => {
  it('queues subscription redirect for both complete and skip-all success paths', () => {
    const screenPath = path.resolve(__dirname, '../app/(auth)/onboarding.tsx');
    const screenSource = fs.readFileSync(screenPath, 'utf8');
    const redirectSetters = screenSource.match(/setPostOnboardingRedirectPath\('\/settings\/subscription'\);/g) ?? [];

    expect(redirectSetters.length).toBe(2);
  });

  it('uses post-onboarding redirect preference when profile completion state flips', () => {
    const screenPath = path.resolve(__dirname, '../app/(auth)/onboarding.tsx');
    const screenSource = fs.readFileSync(screenPath, 'utf8');

    expect(screenSource).toContain("router.replace(postOnboardingRedirectPath ?? '/');");
  });
});
