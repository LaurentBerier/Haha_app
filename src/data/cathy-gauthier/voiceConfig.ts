import type { ArtistVoiceConfig } from '../../config/voiceConfig';

const EXPO_PUBLIC_ELEVENLABS_VOICE_ID_GENERIC = process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID_GENERIC;
const EXPO_PUBLIC_ELEVENLABS_VOICE_ID_CATHY = process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID_CATHY;

const DEFAULT_GENERIC_VOICE_ID = 'cgSgspJ2msm6clMCkdW9';

// Swap Regular -> Premium by setting EXPO_PUBLIC_ELEVENLABS_VOICE_ID_CATHY in env.
export const CATHY_VOICE_CONFIG: ArtistVoiceConfig = {
  provider: 'elevenlabs',
  voiceIdRegular: EXPO_PUBLIC_ELEVENLABS_VOICE_ID_GENERIC ?? DEFAULT_GENERIC_VOICE_ID,
  voiceIdPremium: EXPO_PUBLIC_ELEVENLABS_VOICE_ID_CATHY ?? EXPO_PUBLIC_ELEVENLABS_VOICE_ID_GENERIC ?? DEFAULT_GENERIC_VOICE_ID,
  modelId: 'eleven_v3',
  stability: 0.5,
  similarityBoost: 0.8,
  style: 0.35
};
