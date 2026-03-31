import fs from 'node:fs';
import path from 'node:path';

describe('admin dashboard upgrade wiring', () => {
  it('exposes graph granularity chips and user tier section', () => {
    const dashboardSource = fs.readFileSync(path.join(process.cwd(), 'src/app/admin/index.tsx'), 'utf8');

    expect(dashboardSource).toContain("testID={`admin-granularity-${value}`}");
    expect(dashboardSource).toContain("{ label: 'Hour', value: 'hour' }");
    expect(dashboardSource).toContain("{ label: 'Day', value: 'day' }");
    expect(dashboardSource).toContain("{ label: 'Week', value: 'week' }");
    expect(dashboardSource).toContain("{ label: 'Month', value: 'month' }");
    expect(dashboardSource).toContain('Users by tier');
    expect(dashboardSource).toContain('Est. ElevenLabs cost');
  });

  it('exposes per-user monthly usage reset action in admin users view', () => {
    const usersSource = fs.readFileSync(path.join(process.cwd(), 'src/app/admin/users.tsx'), 'utf8');

    expect(usersSource).toContain('admin-usage-reset');
    expect(usersSource).toContain('Reset monthly usage?');
  });
});
