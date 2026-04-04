import type { AudioPlayerController } from '../hooks/useAudioPlayer';
import { queueLatestWebAutoplayUnlockRetry } from './webAutoplayUnlockService';

export type VoiceAutoplayAttemptState = 'started' | 'pending_web_unlock' | 'failed';
export interface VoiceAutoplayAttemptResultDetailed {
  state: VoiceAutoplayAttemptState;
  failureReason: Exclude<Awaited<ReturnType<AudioPlayerController['playQueue']>>['reason'], 'web_autoplay_blocked' | null> | null;
}

interface AttemptVoiceAutoplayQueueParams {
  audioPlayer: AudioPlayerController;
  uris: string[];
  messageId?: string | null;
  onWebUnlockRetry?: (() => void) | null;
}

interface AttemptVoiceAutoplayUriParams {
  audioPlayer: AudioPlayerController;
  uri: string;
  messageId?: string | null;
  onWebUnlockRetry?: (() => void) | null;
}

function normalizeUris(input: string[]): string[] {
  return input.map((uri) => uri.trim()).filter(Boolean);
}

export async function attemptVoiceAutoplayQueueDetailed({
  audioPlayer,
  uris,
  messageId,
  onWebUnlockRetry
}: AttemptVoiceAutoplayQueueParams): Promise<VoiceAutoplayAttemptResultDetailed> {
  const normalizedUris = normalizeUris(uris);
  if (normalizedUris.length === 0) {
    return {
      state: 'failed',
      failureReason: 'invalid_queue'
    };
  }

  const result = await audioPlayer.playQueue(normalizedUris, {
    messageId: messageId ?? null
  });
  if (result.started) {
    return {
      state: 'started',
      failureReason: null
    };
  }

  if (result.reason === 'web_autoplay_blocked') {
    if (onWebUnlockRetry) {
      queueLatestWebAutoplayUnlockRetry(onWebUnlockRetry);
    }
    return {
      state: 'pending_web_unlock',
      failureReason: null
    };
  }

  return {
    state: 'failed',
    failureReason: result.reason ?? 'playback_error'
  };
}

export async function attemptVoiceAutoplayUriDetailed({
  audioPlayer,
  uri,
  messageId,
  onWebUnlockRetry
}: AttemptVoiceAutoplayUriParams): Promise<VoiceAutoplayAttemptResultDetailed> {
  return attemptVoiceAutoplayQueueDetailed({
    audioPlayer,
    uris: [uri],
    messageId,
    onWebUnlockRetry
  });
}

export async function attemptVoiceAutoplayQueue({
  audioPlayer,
  uris,
  messageId,
  onWebUnlockRetry
}: AttemptVoiceAutoplayQueueParams): Promise<VoiceAutoplayAttemptState> {
  const result = await attemptVoiceAutoplayQueueDetailed({
    audioPlayer,
    uris,
    messageId,
    onWebUnlockRetry
  });
  return result.state;
}

export async function attemptVoiceAutoplayUri({
  audioPlayer,
  uri,
  messageId,
  onWebUnlockRetry
}: AttemptVoiceAutoplayUriParams): Promise<VoiceAutoplayAttemptState> {
  const result = await attemptVoiceAutoplayUriDetailed({
    audioPlayer,
    uri,
    messageId,
    onWebUnlockRetry
  });
  return result.state;
}
