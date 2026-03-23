type EnvCheckResult = {
  missingRequired: string[];
  missingAnyOfGroups: string[][];
};

function hasNonEmptyEnvVar(name: string): boolean {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0;
}

function validateEnv(required: string[], anyOfGroups: string[][]): EnvCheckResult {
  const missingRequired = required.filter((name) => !hasNonEmptyEnvVar(name));
  const missingAnyOfGroups = anyOfGroups.filter(
    (group) => !group.some((name) => hasNonEmptyEnvVar(name))
  );

  return {
    missingRequired,
    missingAnyOfGroups
  };
}

const requiredVars = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ALLOWED_ORIGINS',
  'ANTHROPIC_API_KEY',
  'ELEVENLABS_API_KEY',
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY'
];

const anyOfGroups = [
  ['EXPO_PUBLIC_API_BASE_URL', 'EXPO_PUBLIC_CLAUDE_PROXY_URL'],
  ['KV_URL', 'KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL'],
  ['KV_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN']
];

const result = validateEnv(requiredVars, anyOfGroups);

if (result.missingRequired.length === 0 && result.missingAnyOfGroups.length === 0) {
  console.log('[validateEnv] OK: required environment variables are set.');
  process.exit(0);
}

if (result.missingRequired.length > 0) {
  console.error('[validateEnv] Missing required env vars:');
  for (const name of result.missingRequired) {
    console.error(`- ${name}`);
  }
}

if (result.missingAnyOfGroups.length > 0) {
  console.error('[validateEnv] Missing one-of env groups (set at least one variable in each group):');
  for (const group of result.missingAnyOfGroups) {
    console.error(`- ${group.join(' | ')}`);
  }
}

process.exit(1);
