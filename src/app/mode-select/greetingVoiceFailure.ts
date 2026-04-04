import type { AudioPlaybackFailureReason } from '../../hooks/useAudioPlayer';
import type { Message } from '../../models/Message';
import type { VoiceAutoplayAttemptState } from '../../services/voiceAutoplayService';

export interface GreetingAutoplayFailureConfirmationParams {
  state: VoiceAutoplayAttemptState;
  failureReason: Exclude<AudioPlaybackFailureReason, 'web_autoplay_blocked'> | null;
  messageId: string;
  isPlaying: boolean;
  isLoading: boolean;
  currentMessageId: string | null;
  metadata: Message['metadata'] | null | undefined;
}

function normalizeVoiceQueue(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean);
}

export function hasPlayableGreetingVoice(metadata: Message['metadata'] | null | undefined): boolean {
  if (!metadata) {
    return false;
  }

  const queue = normalizeVoiceQueue(metadata.voiceQueue);
  if (queue.length > 0) {
    return true;
  }

  const voiceUrl = typeof metadata.voiceUrl === 'string' ? metadata.voiceUrl.trim() : '';
  return voiceUrl.length > 0;
}

export function shouldConfirmGreetingAutoplayFailure(
  params: GreetingAutoplayFailureConfirmationParams
): boolean {
  if (params.state !== 'failed') {
    return false;
  }

  const normalizedMessageId = params.messageId.trim();
  const normalizedCurrentMessageId =
    typeof params.currentMessageId === 'string' ? params.currentMessageId.trim() : '';
  if (
    normalizedMessageId &&
    normalizedCurrentMessageId === normalizedMessageId &&
    (params.isPlaying || params.isLoading)
  ) {
    return false;
  }

  if (params.failureReason === 'interrupted' && hasPlayableGreetingVoice(params.metadata)) {
    return false;
  }

  return true;
}
