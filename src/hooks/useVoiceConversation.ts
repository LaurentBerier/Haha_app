import type { ArtistVoiceConfig } from '../config/voiceConfig';

export interface VoiceConversationConfig {
  artistId: string;
  voiceConfig: ArtistVoiceConfig;
  systemPrompt: string;
  language: string;
}

export interface VoiceConversationState {
  isConnected: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  currentTranscript: string;
  error: Error | null;
}

export function useVoiceConversation(_config: VoiceConversationConfig): VoiceConversationState {
  void _config;
  // TODO Phase 4: WebSocket ElevenLabs Conversational AI
  // 1. Connect wss://api.elevenlabs.io/v1/convai/conversation?agent_id=xxx
  // 2. Send audio chunks via expo-speech-recognition
  // 3. Receive TTS stream and play via expo-av / web audio fallback
  throw new Error('Voice conversation mode - Phase 4 not yet implemented');
}
