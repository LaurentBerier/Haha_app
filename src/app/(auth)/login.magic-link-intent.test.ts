import fs from 'node:fs';
import path from 'node:path';

describe('login magic-link intent', () => {
  it('uses auto intent so first-time users can receive a signup-capable link', () => {
    const screenPath = path.resolve(__dirname, './login.tsx');
    const source = fs.readFileSync(screenPath, 'utf8');

    expect(source).toMatch(/requestMagicLink\(\s*email\.trim\(\)\s*,\s*'auto'\s*\)/);
  });
});
