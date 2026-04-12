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

  it('uses sessionStorage-backed web resume restore and does not depend on localStorage', () => {
    const layoutPath = path.resolve(__dirname, '../app/_layout.tsx');
    const layoutSource = fs.readFileSync(layoutPath, 'utf8');

    expect(layoutSource).toContain('window.sessionStorage');
    expect(layoutSource).not.toContain('window.localStorage');
    expect(layoutSource).toContain('WEB_RESUME_ROUTE_RESTORE_FLAG_KEY');
    expect(layoutSource).toContain('const shouldAttemptResumeRestore');
  });

  it('hides global chat input on game routes', () => {
    const layoutPath = path.resolve(__dirname, '../app/_layout.tsx');
    const layoutSource = fs.readFileSync(layoutPath, 'utf8');

    expect(layoutSource).toContain("const isGameRoute = pathname.startsWith('/games/');");
    expect(layoutSource).toContain('!isGameRoute &&');
  });

  it('registers global history route and no longer uses artist-scoped history route', () => {
    const layoutPath = path.resolve(__dirname, '../app/_layout.tsx');
    const layoutSource = fs.readFileSync(layoutPath, 'utf8');

    expect(layoutSource).toContain('<Stack.Screen\n                  name="history/index"');
    expect(layoutSource).not.toContain('name="history/[artistId]"');
  });

  it('uses artist-aware header home navigation and a center artist picker button', () => {
    const layoutPath = path.resolve(__dirname, '../app/_layout.tsx');
    const layoutSource = fs.readFileSync(layoutPath, 'utf8');

    expect(layoutSource).toContain('const headerNavigationArtistId = useMemo(() => {');
    expect(layoutSource).toContain('if (routeArtistId) {');
    expect(layoutSource).toContain('if (isChatRoute && activeConversationArtistId) {');
    expect(layoutSource).toContain("pathname: '/mode-select/[artistId]'");
    expect(layoutSource).toContain('router.replace(\'/\');');
    expect(layoutSource).toContain('testID="header-artist-picker-button"');
  });
});
