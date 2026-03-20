import type { VoiceConversationStatus } from '../../hooks/useVoiceConversation';

export interface ChatInputVoiceActionState {
  canSend: boolean;
  hasConversationMode: boolean;
  isConversationEnabled: boolean;
  micState?: VoiceConversationStatus | null;
}

export type ChatInputVoiceAction =
  | 'send'
  | 'noop'
  | 'enable_and_listen'
  | 'pause_listening'
  | 'resume_listening';

export interface ChatInputVoiceActionHandlers {
  onSend: () => void;
  onEnableAndListen: () => void;
  onPauseListening: () => void;
  onResumeListening: () => void;
}

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

  if (
    state.micState === 'starting' ||
    state.micState === 'listening' ||
    state.micState === 'recovering' ||
    state.micState === 'assistant_busy'
  ) {
    return 'pause_listening';
  }

  return 'resume_listening';
}

export function runChatInputVoiceAction(action: ChatInputVoiceAction, handlers: ChatInputVoiceActionHandlers): void {
  if (action === 'send') {
    handlers.onSend();
    return;
  }

  if (action === 'enable_and_listen') {
    handlers.onEnableAndListen();
    return;
  }

  if (action === 'pause_listening') {
    handlers.onPauseListening();
    return;
  }

  if (action === 'resume_listening') {
    handlers.onResumeListening();
  }
}
