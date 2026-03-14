export interface ArtistVoiceConfig {
  provider: 'elevenlabs';
  voiceIdRegular: string;
  voiceIdPremium: string;
  modelId: string;
  stability: number;
  similarityBoost: number;
  style: number;
}
