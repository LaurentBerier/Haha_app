// Lightweight shared state tracking for the iOS audio session mode.
// Used to avoid redundant setAudioModeAsync calls between useAudioPlayer and voiceEngine.

let recordingReady = false;

export function markAudioSessionRecordingReady(): void {
  recordingReady = true;
}

export function markAudioSessionPlaybackMode(): void {
  recordingReady = false;
}

export function isAudioSessionRecordingReady(): boolean {
  return recordingReady;
}
