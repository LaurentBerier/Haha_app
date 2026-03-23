import fs from 'node:fs';
import path from 'node:path';

describe('root layout route registration', () => {
  it('registers admin as a nested route entry and not direct child screen names', () => {
    const layoutPath = path.resolve(__dirname, '../app/_layout.tsx');
    const layoutSource = fs.readFileSync(layoutPath, 'utf8');

    expect(layoutSource).toContain('<Stack.Screen name="admin"');
    expect(layoutSource).not.toContain('name="admin/index"');
    expect(layoutSource).not.toContain('name="admin/users"');
  });

  it('does not key the root stack by language to avoid navigation remount resets', () => {
    const layoutPath = path.resolve(__dirname, '../app/_layout.tsx');
    const layoutSource = fs.readFileSync(layoutPath, 'utf8');

    expect(layoutSource).not.toContain('<Stack\n                key={language}');
    expect(layoutSource).not.toContain('<Stack key={language}');
  });
});
