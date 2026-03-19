export interface ChatInputVoiceActionState {
  canSend: boolean;
  hasConversationMode: boolean;
  isConversationEnabled: boolean;
  isConversationListening: boolean;
  isConversationPlaying: boolean;
}

export type ChatInputVoiceAction =
  | 'send'
  | 'noop'
  | 'enable_and_listen'
  | 'interrupt_and_listen'
  | 'pause_listening'
  | 'resume_listening';

export function resolveChatInputVoiceAction(state: ChatInputVoiceActionState): ChatInputVoiceAction {
  if (state.canSend) {
    return 'send';
  }

  if (!state.hasConversationMode) {
    return 'noop';
  }

  if (!state.isConversationEnabled) {
    return 'enable_and_listen';
  }

  if (state.isConversationPlaying) {
    return 'interrupt_and_listen';
  }

  if (state.isConversationListening) {
    return 'pause_listening';
  }

  return 'resume_listening';
}
