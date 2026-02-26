type EnvMap = Record<string, string | undefined>;

function getEnv(): EnvMap {
  const globalWithProcess = globalThis as { process?: { env?: EnvMap } };
  return globalWithProcess.process?.env ?? {};
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

const env = getEnv();

export const USE_MOCK_LLM = readBoolean(env.EXPO_PUBLIC_USE_MOCK_LLM, true);
export const ANTHROPIC_API_KEY = env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? '';
export const ANTHROPIC_MODEL = env.EXPO_PUBLIC_ANTHROPIC_MODEL ?? 'claude-sonnet-4-5-20250929';
export const ANTHROPIC_API_VERSION = '2023-06-01';
