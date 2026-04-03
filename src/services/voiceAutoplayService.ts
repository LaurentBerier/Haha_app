import type { AudioPlayerController } from '../hooks/useAudioPlayer';
import { queueLatestWebAutoplayUnlockRetry } from './webAutoplayUnlockService';

export type VoiceAutoplayAttemptState = 'started' | 'pending_web_unlock' | 'failed';

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

export async function attemptVoiceAutoplayQueue({
  audioPlayer,
  uris,
  messageId,
  onWebUnlockRetry
}: AttemptVoiceAutoplayQueueParams): Promise<VoiceAutoplayAttemptState> {
  const normalizedUris = normalizeUris(uris);
  if (normalizedUris.length === 0) {
    return 'failed';
  }

  const result = await audioPlayer.playQueue(normalizedUris, {
    messageId: messageId ?? null
  });
  if (result.started) {
    return 'started';
  }

  if (result.reason === 'web_autoplay_blocked') {
    if (onWebUnlockRetry) {
      queueLatestWebAutoplayUnlockRetry(onWebUnlockRetry);
    }
    return 'pending_web_unlock';
  }

  return 'failed';
}

export async function attemptVoiceAutoplayUri({
  audioPlayer,
  uri,
  messageId,
  onWebUnlockRetry
}: AttemptVoiceAutoplayUriParams): Promise<VoiceAutoplayAttemptState> {
  return attemptVoiceAutoplayQueue({
    audioPlayer,
    uris: [uri],
    messageId,
    onWebUnlockRetry
  });
}
