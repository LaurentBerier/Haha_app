import type { AudioPlaybackFailureReason } from '../../hooks/useAudioPlayer';

export function shouldDowngradeVoiceAfterPlaybackFailure(
  reason: AudioPlaybackFailureReason | null
): boolean {
  return reason === 'playback_error' || reason === 'invalid_queue';
}
