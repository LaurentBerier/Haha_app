import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ChatError } from '../../models/ChatError';
import { t } from '../../i18n';
import { theme } from '../../theme';

interface ChatInputProps {
  onSend: (text: string) => ChatError | null;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled = false }: ChatInputProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<ChatError | null>(null);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    const sendError = onSend(trimmed);
    if (sendError) {
      setError(sendError);
      return;
    }

    setError(null);
    setValue('');
  };

  return (
    <View style={styles.wrapper}>
      <View style={styles.container}>
        <TextInput
          testID="chat-input"
          style={styles.input}
          value={value}
          onChangeText={(nextValue) => {
            if (error) {
              setError(null);
            }
            setValue(nextValue);
          }}
          placeholder={t('chatPlaceholder')}
          placeholderTextColor={theme.colors.textMuted}
          multiline
          editable={!disabled}
        />
        <Pressable
          testID="chat-send-button"
          style={[styles.send, disabled && styles.sendDisabled]}
          onPress={handleSend}
          disabled={disabled}
          accessibilityRole="button"
        >
          <Text style={styles.sendText}>{t('send')}</Text>
        </Pressable>
      </View>
      {error ? (
        <Text style={styles.errorText} testID="chat-input-error">
          {t(error.code)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface
  },
  container: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    color: theme.colors.textPrimary,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm
  },
  send: {
    minWidth: 72,
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: theme.colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md
  },
  sendDisabled: {
    opacity: 0.45
  },
  sendText: {
    color: theme.colors.textPrimary,
    fontWeight: '700'
  },
  errorText: {
    color: theme.colors.error,
    fontSize: 12,
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.sm
  }
});
