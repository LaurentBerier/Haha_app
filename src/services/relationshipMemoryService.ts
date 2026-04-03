import { API_BASE_URL, CLAUDE_PROXY_URL } from '../config/env';

type SupabaseClientType = typeof import('./supabaseClient').supabase;

const RELATIONSHIP_MEMORY_CACHE_TTL_MS = 5 * 60_000;
const RELATIONSHIP_MEMORY_REQUEST_TIMEOUT_MS = 15_000;
const MAX_MEMORY_SUMMARY_CHARS = 320;
const MAX_MEMORY_KEY_FACT_CHARS = 90;
const MAX_MEMORY_KEY_FACTS = 12;
const MAX_SUMMARY_EXCERPT_MESSAGES = 28;
const MAX_SUMMARY_EXCERPT_CHARS = 280;

interface RelationshipMemoryRow {
  artist_id: string;
  summary: string | null;
  key_facts: string[] | null;
  source_user_turn_count: number | null;
  updated_at: string | null;
}

interface RelationshipMemoryCacheEntry {
  cachedAtMs: number;
  snapshot: RelationshipMemorySnapshot;
}

type RelationshipMemoryRole = 'user' | 'assistant';

export interface RelationshipMemoryExcerptMessage {
  role: RelationshipMemoryRole;
  content: string;
}

export interface RelationshipMemorySnapshot {
  artistId: string;
  summary: string;
  keyFacts: string[];
  sourceUserTurnCount: number;
  updatedAt: string;
}

export interface SummarizeRelationshipMemoryParams {
  userId: string;
  artistId: string;
  language: string;
  accessToken: string;
  currentSummary: string;
  currentKeyFacts: string[];
  sourceUserTurnCount: number;
  excerptMessages: RelationshipMemoryExcerptMessage[];
}

const relationshipMemoryCache = new Map<string, RelationshipMemoryCacheEntry>();

async function resolveSupabaseClient(): Promise<SupabaseClientType | null> {
  try {
    const module = await import('./supabaseClient');
    module.assertSupabaseConfigured();
    return module.supabase;
  } catch {
    return null;
  }
}

function normalizeText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeKeyFacts(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== 'string') {
      continue;
    }
    const fact = normalizeText(candidate, MAX_MEMORY_KEY_FACT_CHARS);
    if (!fact) {
      continue;
    }
    const key = fact.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(fact);
    if (normalized.length >= MAX_MEMORY_KEY_FACTS) {
      break;
    }
  }

  return normalized;
}

function normalizeSourceUserTurnCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return new Date().toISOString();
}

function buildCacheKey(userId: string, artistId: string): string {
  return `${userId.trim()}::${artistId.trim()}`;
}

function normalizeSnapshot(
  artistId: string,
  summary: unknown,
  keyFacts: unknown,
  sourceUserTurnCount: unknown,
  updatedAt: unknown
): RelationshipMemorySnapshot | null {
  const normalizedArtistId = normalizeText(artistId, 80);
  if (!normalizedArtistId) {
    return null;
  }

  const normalizedSummary = normalizeText(summary, MAX_MEMORY_SUMMARY_CHARS);
  const normalizedFacts = normalizeKeyFacts(keyFacts);
  if (!normalizedSummary && normalizedFacts.length === 0) {
    return null;
  }

  return {
    artistId: normalizedArtistId,
    summary: normalizedSummary,
    keyFacts: normalizedFacts,
    sourceUserTurnCount: normalizeSourceUserTurnCount(sourceUserTurnCount),
    updatedAt: normalizeTimestamp(updatedAt)
  };
}

function normalizeRelationshipMemoryRow(row: RelationshipMemoryRow | null): RelationshipMemorySnapshot | null {
  if (!row) {
    return null;
  }
  return normalizeSnapshot(
    row.artist_id,
    row.summary,
    row.key_facts,
    row.source_user_turn_count,
    row.updated_at
  );
}

function normalizeRelationshipMemoryResponse(value: unknown, fallbackArtistId: string): RelationshipMemorySnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (record.memory && typeof record.memory === 'object') {
    return normalizeRelationshipMemoryResponse(record.memory, fallbackArtistId);
  }

  const artistId = normalizeText(record.artistId ?? record.artist_id ?? fallbackArtistId, 80);
  return normalizeSnapshot(
    artistId,
    record.summary,
    record.keyFacts ?? record.key_facts,
    record.sourceUserTurnCount ?? record.source_user_turn_count,
    record.updatedAt ?? record.updated_at
  );
}

function setCachedRelationshipMemory(userId: string, snapshot: RelationshipMemorySnapshot): void {
  const cacheKey = buildCacheKey(userId, snapshot.artistId);
  relationshipMemoryCache.set(cacheKey, {
    cachedAtMs: Date.now(),
    snapshot
  });
}

export function clearRelationshipMemoryCache(userId?: string): void {
  if (!userId) {
    relationshipMemoryCache.clear();
    return;
  }

  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    return;
  }

  for (const key of relationshipMemoryCache.keys()) {
    if (key.startsWith(`${normalizedUserId}::`)) {
      relationshipMemoryCache.delete(key);
    }
  }
}

export function getCachedRelationshipMemory(userId: string, artistId: string): RelationshipMemorySnapshot | null {
  const cacheKey = buildCacheKey(userId, artistId);
  const cached = relationshipMemoryCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (Date.now() - cached.cachedAtMs > RELATIONSHIP_MEMORY_CACHE_TTL_MS) {
    relationshipMemoryCache.delete(cacheKey);
    return null;
  }

  return cached.snapshot;
}

export async function fetchRelationshipMemory(
  userId: string,
  artistId: string,
  options?: { force?: boolean }
): Promise<RelationshipMemorySnapshot | null> {
  const normalizedUserId = userId.trim();
  const normalizedArtistId = artistId.trim();
  if (!normalizedUserId || !normalizedArtistId) {
    return null;
  }

  if (!options?.force) {
    const cached = getCachedRelationshipMemory(normalizedUserId, normalizedArtistId);
    if (cached) {
      return cached;
    }
  }

  const supabaseClient = await resolveSupabaseClient();
  if (!supabaseClient) {
    return null;
  }

  const { data, error } = await supabaseClient
    .from('relationship_memories')
    .select('artist_id, summary, key_facts, source_user_turn_count, updated_at')
    .eq('user_id', normalizedUserId)
    .eq('artist_id', normalizedArtistId)
    .maybeSingle<RelationshipMemoryRow>();

  if (error) {
    throw error;
  }

  const normalized = normalizeRelationshipMemoryRow(data ?? null);
  if (!normalized) {
    relationshipMemoryCache.delete(buildCacheKey(normalizedUserId, normalizedArtistId));
    return null;
  }

  setCachedRelationshipMemory(normalizedUserId, normalized);
  return normalized;
}

export async function upsertRelationshipMemory(
  userId: string,
  payload: {
    artistId: string;
    summary: string;
    keyFacts: string[];
    sourceUserTurnCount: number;
  }
): Promise<RelationshipMemorySnapshot | null> {
  const normalizedUserId = userId.trim();
  const normalizedArtistId = payload.artistId.trim();
  if (!normalizedUserId || !normalizedArtistId) {
    return null;
  }

  const supabaseClient = await resolveSupabaseClient();
  if (!supabaseClient) {
    return null;
  }

  const rowPayload = {
    user_id: normalizedUserId,
    artist_id: normalizedArtistId,
    summary: normalizeText(payload.summary, MAX_MEMORY_SUMMARY_CHARS),
    key_facts: normalizeKeyFacts(payload.keyFacts),
    source_user_turn_count: normalizeSourceUserTurnCount(payload.sourceUserTurnCount),
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabaseClient
    .from('relationship_memories')
    .upsert(rowPayload, {
      onConflict: 'user_id,artist_id'
    })
    .select('artist_id, summary, key_facts, source_user_turn_count, updated_at')
    .maybeSingle<RelationshipMemoryRow>();

  if (error) {
    throw error;
  }

  const normalized = normalizeRelationshipMemoryRow(data ?? null);
  if (!normalized) {
    return null;
  }

  setCachedRelationshipMemory(normalizedUserId, normalized);
  return normalized;
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function buildMemorySummarizeEndpointCandidates(): string[] {
  const isWebRuntime = typeof window !== 'undefined';
  const candidates: string[] = [];

  const addCandidate = (candidate: string) => {
    const normalized = candidate.trim();
    if (!normalized) {
      return;
    }
    if (!isWebRuntime && normalized.startsWith('/')) {
      return;
    }
    if (!candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  };

  if (isWebRuntime && typeof window.location?.origin === 'string' && window.location.origin) {
    const origin = normalizeUrl(window.location.origin);
    if (origin) {
      addCandidate(`${origin}/api/memory-summarize`);
    }
    addCandidate('/api/memory-summarize');
  }

  const apiBase = normalizeUrl(API_BASE_URL);
  if (apiBase) {
    addCandidate(`${apiBase}/memory-summarize`);
  }

  const claudeProxy = normalizeUrl(CLAUDE_PROXY_URL);
  if (claudeProxy) {
    if (claudeProxy.endsWith('/claude')) {
      addCandidate(`${claudeProxy.slice(0, -'/claude'.length)}/memory-summarize`);
    } else {
      addCandidate(`${claudeProxy}/memory-summarize`);
    }
  }

  return candidates;
}

function normalizeExcerptMessages(messages: RelationshipMemoryExcerptMessage[]): RelationshipMemoryExcerptMessage[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  const normalized: RelationshipMemoryExcerptMessage[] = [];
  for (const message of messages) {
    if (!message || typeof message !== 'object') {
      continue;
    }
    const role = message.role === 'assistant' ? 'assistant' : message.role === 'user' ? 'user' : null;
    if (!role) {
      continue;
    }
    const content = normalizeText(message.content, MAX_SUMMARY_EXCERPT_CHARS);
    if (!content) {
      continue;
    }
    normalized.push({
      role,
      content
    });
    if (normalized.length >= MAX_SUMMARY_EXCERPT_MESSAGES) {
      break;
    }
  }

  return normalized;
}

export async function summarizeRelationshipMemory(
  params: SummarizeRelationshipMemoryParams
): Promise<RelationshipMemorySnapshot | null> {
  const normalizedUserId = params.userId.trim();
  const normalizedArtistId = params.artistId.trim();
  const token = params.accessToken.trim();
  if (!normalizedUserId || !normalizedArtistId || !token) {
    return null;
  }

  const endpointCandidates = buildMemorySummarizeEndpointCandidates();
  if (endpointCandidates.length === 0) {
    return null;
  }

  const normalizedExcerptMessages = normalizeExcerptMessages(params.excerptMessages);
  if (normalizedExcerptMessages.length === 0) {
    return null;
  }

  const payload = {
    artistId: normalizedArtistId,
    language: normalizeText(params.language, 20) || 'fr-CA',
    currentSummary: normalizeText(params.currentSummary, MAX_MEMORY_SUMMARY_CHARS),
    currentKeyFacts: normalizeKeyFacts(params.currentKeyFacts),
    sourceUserTurnCount: normalizeSourceUserTurnCount(params.sourceUserTurnCount),
    excerptMessages: normalizedExcerptMessages
  };

  for (const endpoint of endpointCandidates) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), RELATIONSHIP_MEMORY_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!response.ok) {
        continue;
      }

      const data = (await response.json()) as unknown;
      const normalized = normalizeRelationshipMemoryResponse(data, normalizedArtistId);
      if (!normalized) {
        continue;
      }

      setCachedRelationshipMemory(normalizedUserId, normalized);
      return normalized;
    } catch {
      // Try next endpoint candidate.
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  return null;
}
