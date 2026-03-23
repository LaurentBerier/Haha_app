import { Platform, StyleSheet, View } from 'react-native';
import { ChatInput } from '../chat/ChatInput';
import type { ChatSendPayload } from '../../models/ChatSendPayload';
import { theme } from '../../theme';
import type { VoiceConversationStatus } from '../../hooks/useVoiceConversation';

interface GlobalChatInputProps {
  visible: boolean;
  disabled: boolean;
  conversationModeEnabled: boolean;
  isListening: boolean;
  transcript: string;
  error: string | null;
  status: VoiceConversationStatus;
  hint: string | null;
  onSend: (payload: ChatSendPayload) => void;
  onEnableConversationMode: () => void;
  onPauseListening: () => void;
  onResumeListening: () => void;
  onTypingStateChange: (hasTypedDraft: boolean) => void;
}

export function GlobalChatInput({
  visible,
  disabled,
  conversationModeEnabled,
  isListening,
  transcript,
  error,
  status,
  hint,
  onSend,
  onEnableConversationMode,
  onPauseListening,
  onResumeListening,
  onTypingStateChange
}: GlobalChatInputProps) {
  if (!visible) {
    return null;
  }

  return (
    <View style={styles.globalInputDock}>
      <View style={styles.globalInputContent}>
        <ChatInput
          onSend={(payload) => {
            onSend(payload);
            return null;
          }}
          disabled={disabled}
          conversationMode={{
            enabled: conversationModeEnabled,
            isListening,
            transcript,
            error,
            micState: status,
            hint,
            onToggle: onEnableConversationMode,
            onPauseListening,
            onResumeListening,
            onTypingStateChange
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  globalInputDock: {
    width: '100%',
    paddingBottom: Platform.OS === 'ios' ? theme.spacing.sm : theme.spacing.xs
  },
  globalInputContent: {
    width: '100%',
    maxWidth: 784,
    alignSelf: 'center'
  }
});
