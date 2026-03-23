export type ChatBubbleVoiceControlState = 'ready' | 'generating' | 'unavailable' | 'hidden';

export function resolveChatBubbleVoiceControlState(params: {
  isEligible: boolean;
  voiceUrl: string;
  voiceStatus: 'generating' | 'ready' | 'unavailable' | undefined;
}): ChatBubbleVoiceControlState {
  if (!params.isEligible) {
    return 'hidden';
  }
  if (params.voiceUrl.trim().length > 0) {
    return 'ready';
  }
  if (params.voiceStatus === 'generating') {
    return 'generating';
  }
  return 'unavailable';
}

export function resolveVoiceUnavailableTranslationKey(code: string | null | undefined):
  | 'voiceUnavailableRateLimit'
  | 'voiceUnavailableQuota'
  | 'voiceUnavailableForbidden'
  | 'voiceUnavailableGeneric' {
  if (code === 'RATE_LIMIT_EXCEEDED') {
    return 'voiceUnavailableRateLimit';
  }
  if (code === 'TTS_QUOTA_EXCEEDED') {
    return 'voiceUnavailableQuota';
  }
  if (code === 'TTS_FORBIDDEN' || code === 'UNAUTHORIZED') {
    return 'voiceUnavailableForbidden';
  }
  return 'voiceUnavailableGeneric';
}
