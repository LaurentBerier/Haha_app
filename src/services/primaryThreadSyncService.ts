import { MODE_IDS } from '../config/constants';
import { normalizeConversationThreadType, type Conversation } from '../models/Conversation';
import type { Message, MessageMetadata } from '../models/Message';
import type { StoreState } from '../store/useStore';
import { useStore } from '../store/useStore';

type SupabaseClientType = typeof import('./supabaseClient').supabase;

const PRIMARY_THREAD_REMOTE_MESSAGE_CAP = 500;
const PRIMARY_THREAD_SYNC_BATCH_SIZE = 100;
const TRIM_RPC_DISABLED_SESSION_KEYS = new Set<string>();

interface RpcErrorLike {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
}

interface PrimaryThreadRow {
  user_id: string;
  artist_id: string;
  language: string | null;
  title: string | null;
  last_message_preview: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface PrimaryThreadMessageRow {
  user_id: string;
  artist_id: string;
  message_id: string;
  role: string;
  content: string | null;
  timestamp: string | null;
  status: string | null;
  metadata: unknown;
}

interface PrimaryThreadMessageIdRow {
  message_id: string | null;
}

interface PrimaryThreadUpsertRow {
  user_id: string;
  artist_id: string;
  language: string;
  title: string;
  last_message_preview: string;
  updated_at: string;
}

interface PrimaryThreadMessageUpsertRow {
  user_id: string;
  artist_id: string;
  message_id: string;
  role: 'user' | 'artist';
  content: string;
  timestamp: string;
  status: 'complete';
  metadata: Record<string, unknown>;
  updated_at: string;
}

export interface CloudPrimaryThread {
  userId: string;
  artistId: string;
  language: string;
  title: string;
  lastMessagePreview: string;
  createdAt: string;
  updatedAt: string;
}

export interface CloudPrimaryThreadMessage {
  id: string;
  role: 'user' | 'artist';
  content: string;
  timestamp: string;
  status: 'complete';
  metadata?: Record<string, unknown>;
}

export interface SyncPrimaryThreadArtistResult {
  skipped: boolean;
  uploadedMessagesCount: number;
  localCompleteMessagesCount: number;
}

const SYNCED_METADATA_KEYS: Array<keyof MessageMetadata> = [
  'tokensUsed',
  'cathyReaction',
  'tutorialMode',
  'injectedType',
  'battleResult',
  'injected',
  'showUpgradeCta',
  'upgradeFromTier',
  'errorCode',
  'errorMessage',
  'memeType',
  'memeDraftId',
  'memeOptionId',
  'memeOptionRank',
  'memeCaption',
  'memePlacement',
  'memeLogoPlacement',
  'memeSelected',
  'greetingActivitySnapshot'
];

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTimestamp(value: unknown, fallback: string = new Date().toISOString()): string {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return fallback;
}

function normalizeMessageRole(value: unknown): 'user' | 'artist' | null {
  if (value === 'user' || value === 'artist') {
    return value;
  }
  return null;
}

function normalizeRpcErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return '';
  }
  const candidate = (error as RpcErrorLike).code;
  return typeof candidate === 'string' ? candidate.trim() : '';
}

function normalizeRpcErrorText(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return '';
  }
  const candidate = error as RpcErrorLike;
  return [candidate.message, candidate.details, candidate.hint]
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function isTrimRpcFunctionUnavailable(error: unknown): boolean {
  const code = normalizeRpcErrorCode(error);
  if (code === 'PGRST202' || code === '42883') {
    return true;
  }

  const text = normalizeRpcErrorText(error);
  return text.includes('trim_primary_thread_messages') && (text.includes('does not exist') || text.includes('not found'));
}

function isTrimRpcAuthContextUnavailable(error: unknown): boolean {
  const code = normalizeRpcErrorCode(error);
  if (code === 'PGRST301' || code === '401') {
    return true;
  }

  const text = normalizeRpcErrorText(error);
  return (
    text.includes('authenticated user required') ||
    (text.includes('jwt') && text.includes('invalid')) ||
    (text.includes('auth.uid') && text.includes('null'))
  );
}

function shouldDisableTrimRpcForSession(error: unknown): boolean {
  return isTrimRpcFunctionUnavailable(error) || isTrimRpcAuthContextUnavailable(error);
}

function buildTrimSessionKey(userId: string, artistId: string): string {
  return `${userId}:${artistId}`;
}

export function __resetPrimaryThreadSyncServiceForTests(): void {
  TRIM_RPC_DISABLED_SESSION_KEYS.clear();
}

function isPrimitiveJsonValue(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function projectGreetingActivitySnapshot(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const payload: Record<string, unknown> = {};

  if (typeof source.punchlinesCreated === 'number' && Number.isFinite(source.punchlinesCreated)) {
    payload.punchlinesCreated = source.punchlinesCreated;
  }
  if (typeof source.battleWins === 'number' && Number.isFinite(source.battleWins)) {
    payload.battleWins = source.battleWins;
  }
  if (typeof source.memesGenerated === 'number' && Number.isFinite(source.memesGenerated)) {
    payload.memesGenerated = source.memesGenerated;
  }
  if (typeof source.photosRoasted === 'number' && Number.isFinite(source.photosRoasted)) {
    payload.photosRoasted = source.photosRoasted;
  }
  if (typeof source.roastsGenerated === 'number' && Number.isFinite(source.roastsGenerated)) {
    payload.roastsGenerated = source.roastsGenerated;
  }
  if (typeof source.capturedAt === 'string') {
    payload.capturedAt = normalizeTimestamp(source.capturedAt);
  }

  return Object.keys(payload).length > 0 ? payload : undefined;
}

function projectMessageMetadataForCloud(metadata: MessageMetadata | undefined): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object') {
    return {};
  }

  const projected: Record<string, unknown> = {};
  for (const key of SYNCED_METADATA_KEYS) {
    const candidate = metadata[key];
    if (candidate === undefined || candidate === null) {
      continue;
    }

    if (key === 'greetingActivitySnapshot') {
      const snapshot = projectGreetingActivitySnapshot(candidate);
      if (snapshot) {
        projected[key] = snapshot;
      }
      continue;
    }

    if (isPrimitiveJsonValue(candidate)) {
      projected[key] = candidate;
    }
  }

  return projected;
}

function normalizeCloudMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};

  for (const key of SYNCED_METADATA_KEYS) {
    const candidate = source[key];
    if (candidate === undefined || candidate === null) {
      continue;
    }

    if (key === 'greetingActivitySnapshot') {
      const snapshot = projectGreetingActivitySnapshot(candidate);
      if (snapshot) {
        normalized[key] = snapshot;
      }
      continue;
    }

    if (isPrimitiveJsonValue(candidate)) {
      normalized[key] = candidate;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeThreadRow(row: PrimaryThreadRow | null): CloudPrimaryThread | null {
  if (!row) {
    return null;
  }

  const userId = normalizeText(row.user_id);
  const artistId = normalizeText(row.artist_id);
  if (!userId || !artistId) {
    return null;
  }

  const fallbackTimestamp = new Date().toISOString();
  return {
    userId,
    artistId,
    language: normalizeText(row.language) || 'fr-CA',
    title: row.title ?? '',
    lastMessagePreview: row.last_message_preview ?? '',
    createdAt: normalizeTimestamp(row.created_at, fallbackTimestamp),
    updatedAt: normalizeTimestamp(row.updated_at, fallbackTimestamp)
  };
}

function normalizeMessageRow(row: PrimaryThreadMessageRow | null): CloudPrimaryThreadMessage | null {
  if (!row) {
    return null;
  }

  const id = normalizeText(row.message_id);
  const role = normalizeMessageRole(row.role);
  if (!id || !role || row.status !== 'complete') {
    return null;
  }

  return {
    id,
    role,
    content: typeof row.content === 'string' ? row.content : '',
    timestamp: normalizeTimestamp(row.timestamp),
    status: 'complete',
    metadata: normalizeCloudMetadata(row.metadata)
  };
}

async function resolveSupabaseClient(): Promise<SupabaseClientType | null> {
  try {
    const module = await import('./supabaseClient');
    module.assertSupabaseConfigured();
    return module.supabase;
  } catch {
    return null;
  }
}

function resolveLocalPrimaryConversation(state: StoreState, artistId: string): Conversation | null {
  const artistConversations = state.conversations[artistId] ?? [];
  const localPrimaryThreads = artistConversations.filter(
    (conversation) => normalizeConversationThreadType(conversation.threadType) === 'primary'
  );

  if (localPrimaryThreads.length === 0) {
    return null;
  }

  return (
    localPrimaryThreads
      .slice()
      .sort((left, right) => {
        const leftTime = Date.parse(left.updatedAt);
        const rightTime = Date.parse(right.updatedAt);
        return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
      })[0] ?? null
  );
}

function buildThreadUpsertRow(userId: string, artistId: string, conversation: Conversation): PrimaryThreadUpsertRow {
  return {
    user_id: userId,
    artist_id: artistId,
    language: normalizeText(conversation.language) || 'fr-CA',
    title: conversation.title ?? '',
    last_message_preview: conversation.lastMessagePreview ?? '',
    updated_at: normalizeTimestamp(conversation.updatedAt)
  };
}

function buildCompleteMessagesForSync(params: {
  userId: string;
  artistId: string;
  messages: Message[];
}): PrimaryThreadMessageUpsertRow[] {
  const { userId, artistId, messages } = params;
  const normalizedUserId = userId.trim();
  const normalizedArtistId = artistId.trim();
  const dedupedMessages = new Map<string, PrimaryThreadMessageUpsertRow>();

  for (const message of messages) {
    if (message.status !== 'complete') {
      continue;
    }

    const messageId = normalizeText(message.id);
    const role = normalizeMessageRole(message.role);
    if (!messageId || !role) {
      continue;
    }

    const timestamp = normalizeTimestamp(message.timestamp);
    const candidate: PrimaryThreadMessageUpsertRow = {
      user_id: normalizedUserId,
      artist_id: normalizedArtistId,
      message_id: messageId,
      role,
      content: typeof message.content === 'string' ? message.content : '',
      timestamp,
      status: 'complete',
      metadata: projectMessageMetadataForCloud(message.metadata),
      updated_at: new Date().toISOString()
    };

    const previous = dedupedMessages.get(messageId);
    if (!previous) {
      dedupedMessages.set(messageId, candidate);
      continue;
    }

    const previousTime = Date.parse(previous.timestamp);
    const nextTime = Date.parse(candidate.timestamp);
    if ((Number.isFinite(nextTime) ? nextTime : 0) >= (Number.isFinite(previousTime) ? previousTime : 0)) {
      dedupedMessages.set(messageId, candidate);
    }
  }

  return Array.from(dedupedMessages.values()).sort((left, right) => {
    const leftTime = Date.parse(left.timestamp);
    const rightTime = Date.parse(right.timestamp);
    const safeLeft = Number.isFinite(leftTime) ? leftTime : 0;
    const safeRight = Number.isFinite(rightTime) ? rightTime : 0;
    if (safeLeft !== safeRight) {
      return safeLeft - safeRight;
    }
    return left.message_id.localeCompare(right.message_id);
  });
}

async function fetchRemoteThreadRow(
  supabaseClient: SupabaseClientType,
  userId: string,
  artistId: string
): Promise<CloudPrimaryThread | null> {
  const { data, error } = await supabaseClient
    .from('primary_threads')
    .select('user_id, artist_id, language, title, last_message_preview, created_at, updated_at')
    .eq('user_id', userId)
    .eq('artist_id', artistId)
    .maybeSingle<PrimaryThreadRow>();

  if (error) {
    throw error;
  }

  return normalizeThreadRow(data ?? null);
}

export async function fetchPrimaryThreadIndex(userId: string): Promise<CloudPrimaryThread[]> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    return [];
  }

  const supabaseClient = await resolveSupabaseClient();
  if (!supabaseClient) {
    return [];
  }

  const { data, error } = await supabaseClient
    .from('primary_threads')
    .select('user_id, artist_id, language, title, last_message_preview, created_at, updated_at')
    .eq('user_id', normalizedUserId)
    .order('updated_at', { ascending: false });

  if (error) {
    throw error;
  }

  const rows = Array.isArray(data) ? (data as PrimaryThreadRow[]) : [];
  const normalized = rows
    .map((row) => normalizeThreadRow(row))
    .filter((row): row is CloudPrimaryThread => row !== null);

  const dedupedByArtist = new Map<string, CloudPrimaryThread>();
  for (const thread of normalized) {
    const previous = dedupedByArtist.get(thread.artistId);
    if (!previous) {
      dedupedByArtist.set(thread.artistId, thread);
      continue;
    }

    const previousTime = Date.parse(previous.updatedAt);
    const nextTime = Date.parse(thread.updatedAt);
    if ((Number.isFinite(nextTime) ? nextTime : 0) > (Number.isFinite(previousTime) ? previousTime : 0)) {
      dedupedByArtist.set(thread.artistId, thread);
    }
  }

  return Array.from(dedupedByArtist.values()).sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt);
    const rightTime = Date.parse(right.updatedAt);
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  });
}

export async function fetchPrimaryThreadMessages(
  userId: string,
  artistId: string,
  limit: number = PRIMARY_THREAD_REMOTE_MESSAGE_CAP
): Promise<CloudPrimaryThreadMessage[]> {
  const normalizedUserId = userId.trim();
  const normalizedArtistId = artistId.trim();
  if (!normalizedUserId || !normalizedArtistId) {
    return [];
  }

  const supabaseClient = await resolveSupabaseClient();
  if (!supabaseClient) {
    return [];
  }

  const normalizedLimit = Math.max(1, Math.min(Math.floor(limit), PRIMARY_THREAD_REMOTE_MESSAGE_CAP));
  const { data, error } = await supabaseClient
    .from('primary_thread_messages')
    .select('user_id, artist_id, message_id, role, content, timestamp, status, metadata')
    .eq('user_id', normalizedUserId)
    .eq('artist_id', normalizedArtistId)
    .order('timestamp', { ascending: false })
    .limit(normalizedLimit);

  if (error) {
    throw error;
  }

  const rows = Array.isArray(data) ? (data as PrimaryThreadMessageRow[]) : [];

  const normalized = rows
    .map((row) => normalizeMessageRow(row))
    .filter((row): row is CloudPrimaryThreadMessage => row !== null);

  const dedupedById = new Map<string, CloudPrimaryThreadMessage>();
  for (const message of normalized) {
    const previous = dedupedById.get(message.id);
    if (!previous) {
      dedupedById.set(message.id, message);
      continue;
    }

    const previousTime = Date.parse(previous.timestamp);
    const nextTime = Date.parse(message.timestamp);
    if ((Number.isFinite(nextTime) ? nextTime : 0) > (Number.isFinite(previousTime) ? previousTime : 0)) {
      dedupedById.set(message.id, message);
    }
  }

  return Array.from(dedupedById.values()).sort((left, right) => {
    const leftTime = Date.parse(left.timestamp);
    const rightTime = Date.parse(right.timestamp);
    const safeLeft = Number.isFinite(leftTime) ? leftTime : 0;
    const safeRight = Number.isFinite(rightTime) ? rightTime : 0;
    if (safeLeft !== safeRight) {
      return safeLeft - safeRight;
    }
    return left.id.localeCompare(right.id);
  });
}

export async function syncPrimaryThreadArtist(userId: string, artistId: string): Promise<SyncPrimaryThreadArtistResult> {
  const normalizedUserId = userId.trim();
  const normalizedArtistId = artistId.trim();
  if (!normalizedUserId || !normalizedArtistId) {
    return {
      skipped: true,
      uploadedMessagesCount: 0,
      localCompleteMessagesCount: 0
    };
  }

  const supabaseClient = await resolveSupabaseClient();
  if (!supabaseClient) {
    return {
      skipped: true,
      uploadedMessagesCount: 0,
      localCompleteMessagesCount: 0
    };
  }

  const storeState = useStore.getState();
  const localPrimaryConversation = resolveLocalPrimaryConversation(storeState, normalizedArtistId);
  if (!localPrimaryConversation) {
    const remoteThread = await fetchRemoteThreadRow(supabaseClient, normalizedUserId, normalizedArtistId);
    if (remoteThread) {
      useStore.getState().upsertPrimaryConversationFromCloud(normalizedArtistId, {
        language: remoteThread.language,
        title: remoteThread.title,
        lastMessagePreview: remoteThread.lastMessagePreview,
        updatedAt: remoteThread.updatedAt,
        createdAt: remoteThread.createdAt
      });
    }

    return {
      skipped: true,
      uploadedMessagesCount: 0,
      localCompleteMessagesCount: 0
    };
  }

  const localMessages = storeState.messagesByConversation[localPrimaryConversation.id]?.messages ?? [];
  const completeLocalMessages = buildCompleteMessagesForSync({
    userId: normalizedUserId,
    artistId: normalizedArtistId,
    messages: localMessages
  });

  const remoteThread = await fetchRemoteThreadRow(supabaseClient, normalizedUserId, normalizedArtistId);
  const remoteUpdatedAtMs = Date.parse(remoteThread?.updatedAt ?? '');
  const localUpdatedAtMs = Date.parse(localPrimaryConversation.updatedAt);
  const isRemoteMetadataNewer =
    remoteThread !== null &&
    (Number.isFinite(remoteUpdatedAtMs) ? remoteUpdatedAtMs : 0) >
      (Number.isFinite(localUpdatedAtMs) ? localUpdatedAtMs : 0);

  if (isRemoteMetadataNewer && remoteThread) {
    useStore.getState().upsertPrimaryConversationFromCloud(normalizedArtistId, {
      language: remoteThread.language,
      title: remoteThread.title,
      lastMessagePreview: remoteThread.lastMessagePreview,
      updatedAt: remoteThread.updatedAt,
      createdAt: remoteThread.createdAt
    });
  } else {
    const threadUpsert = buildThreadUpsertRow(normalizedUserId, normalizedArtistId, {
      ...localPrimaryConversation,
      modeId: localPrimaryConversation.modeId || MODE_IDS.ON_JASE,
      updatedAt: normalizeTimestamp(localPrimaryConversation.updatedAt)
    });

    const { error: threadUpsertError } = await supabaseClient
      .from('primary_threads')
      .upsert(threadUpsert, { onConflict: 'user_id,artist_id' });

    if (threadUpsertError) {
      throw threadUpsertError;
    }
  }

  const { data: remoteMessageIdData, error: remoteMessageIdError } = await supabaseClient
    .from('primary_thread_messages')
    .select('message_id')
    .eq('user_id', normalizedUserId)
    .eq('artist_id', normalizedArtistId);

  if (remoteMessageIdError) {
    throw remoteMessageIdError;
  }

  const remoteIds = new Set<string>();
  const remoteIdRows = Array.isArray(remoteMessageIdData) ? (remoteMessageIdData as PrimaryThreadMessageIdRow[]) : [];
  for (const row of remoteIdRows) {
    const normalizedId = normalizeText(row.message_id);
    if (normalizedId) {
      remoteIds.add(normalizedId);
    }
  }

  const missingMessages = completeLocalMessages.filter((message) => !remoteIds.has(message.message_id));

  for (let index = 0; index < missingMessages.length; index += PRIMARY_THREAD_SYNC_BATCH_SIZE) {
    const chunk = missingMessages.slice(index, index + PRIMARY_THREAD_SYNC_BATCH_SIZE);
    const { error: messageUpsertError } = await supabaseClient
      .from('primary_thread_messages')
      .upsert(chunk, { onConflict: 'user_id,artist_id,message_id' });

    if (messageUpsertError) {
      throw messageUpsertError;
    }
  }

  const trimSessionKey = buildTrimSessionKey(normalizedUserId, normalizedArtistId);
  if (!TRIM_RPC_DISABLED_SESSION_KEYS.has(trimSessionKey)) {
    const { error: trimError } = await supabaseClient.rpc('trim_primary_thread_messages', {
      artist_id: normalizedArtistId,
      keep_count: PRIMARY_THREAD_REMOTE_MESSAGE_CAP
    });

    if (trimError) {
      if (shouldDisableTrimRpcForSession(trimError)) {
        TRIM_RPC_DISABLED_SESSION_KEYS.add(trimSessionKey);
      }
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[primaryThreadSyncService] trim_primary_thread_messages skipped', {
          userId: normalizedUserId,
          artistId: normalizedArtistId,
          code: normalizeRpcErrorCode(trimError),
          message: normalizeRpcErrorText(trimError)
        });
      }
    }
  }

  return {
    skipped: false,
    uploadedMessagesCount: missingMessages.length,
    localCompleteMessagesCount: completeLocalMessages.length
  };
}
