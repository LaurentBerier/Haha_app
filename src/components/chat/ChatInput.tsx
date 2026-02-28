import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { MAX_IMAGE_UPLOAD_BYTES, MAX_MESSAGE_LENGTH } from '../../config/constants';
import { featureFlags } from '../../config/featureFlags';
import { useVoiceInput } from '../../hooks/useVoiceInput';
import { t } from '../../i18n';
import type { ChatError } from '../../models/ChatError';
import type { ChatImageAttachment, ChatSendPayload } from '../../models/ChatSendPayload';
import type { ClaudeImageMediaType } from '../../services/claudeApiService';
import type { VoiceStatus } from '../../store/slices/uiSlice';
import { theme } from '../../theme';

interface ChatInputProps {
  onSend: (payload: ChatSendPayload) => ChatError | null;
  disabled?: boolean;
}

const IMAGE_MEDIA_TYPES = new Set<ClaudeImageMediaType>(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function useVoiceAnimations(voiceStatus: VoiceStatus) {
  const pulse = useRef(new Animated.Value(1)).current;
  const shake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (voiceStatus === 'recording') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.08, duration: 380, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 380, useNativeDriver: true })
        ])
      );
      loop.start();
      return () => {
        loop.stop();
        pulse.setValue(1);
      };
    }

    pulse.setValue(1);
    return undefined;
  }, [pulse, voiceStatus]);

  useEffect(() => {
    if (voiceStatus !== 'error') {
      shake.setValue(0);
      return;
    }

    Animated.sequence([
      Animated.timing(shake, { toValue: -5, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 5, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -3, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 3, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 50, useNativeDriver: true })
    ]).start();
  }, [shake, voiceStatus]);

  return { pulse, shake };
}

function normalizeImageMediaType(rawMimeType: string | null | undefined): ClaudeImageMediaType | null {
  if (!rawMimeType) {
    return null;
  }

  const normalized = rawMimeType.toLowerCase();
  const mapped = normalized === 'image/jpg' ? 'image/jpeg' : normalized;

  return IMAGE_MEDIA_TYPES.has(mapped as ClaudeImageMediaType) ? (mapped as ClaudeImageMediaType) : null;
}

function estimateBase64Bytes(base64: string): number {
  const trimmed = base64.trim();
  const padding = trimmed.endsWith('==') ? 2 : trimmed.endsWith('=') ? 1 : 0;
  return Math.floor((trimmed.length * 3) / 4) - padding;
}

export function ChatInput({ onSend, disabled = false }: ChatInputProps) {
  const [value, setValue] = useState('');
  const [imageAttachment, setImageAttachment] = useState<ChatImageAttachment | null>(null);
  const [isPickingImage, setIsPickingImage] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);

  const { voiceStatus, transcript, voiceError, startRecording, stopRecording } = useVoiceInput();
  const { pulse, shake } = useVoiceAnimations(voiceStatus);

  const trimmed = value.trim();
  const hasText = trimmed.length > 0;
  const hasImage = Boolean(imageAttachment);
  const canSend = (hasText || hasImage) && !disabled && voiceStatus !== 'transcribing' && voiceStatus !== 'recording';

  const clearValidationErrors = () => {
    if (error) {
      setError(null);
    }
    if (pickerError) {
      setPickerError(null);
    }
  };

  const handleSend = () => {
    if (!hasText && !hasImage) {
      return;
    }

    const sendError = onSend({ text: trimmed, image: imageAttachment });
    if (sendError) {
      setError(sendError);
      return;
    }

    setError(null);
    setPickerError(null);
    setValue('');
    setImageAttachment(null);
  };

  const handleVoiceToggle = async () => {
    if (!featureFlags.enableVoice || disabled || voiceStatus === 'transcribing') {
      return;
    }

    if (voiceStatus === 'recording') {
      const finalTranscript = (await stopRecording()).trim();
      if (finalTranscript) {
        clearValidationErrors();
        setValue(finalTranscript);
      }
      return;
    }

    await startRecording();
  };

  const handlePickImage = async () => {
    if (disabled || isPickingImage) {
      return;
    }

    setIsPickingImage(true);
    setPickerError(null);

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setPickerError(t('imagePickerPermissionDenied'));
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'] as ImagePicker.MediaType[],
        allowsEditing: false,
        quality: 0.7,
        base64: true,
        exif: false
      });

      if (result.canceled || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      if (!asset) {
        return;
      }

      const base64 = asset.base64;
      const mediaType = normalizeImageMediaType(asset.mimeType);

      if (!base64 || !mediaType) {
        setPickerError(t('imagePickerUnsupported'));
        return;
      }

      if (estimateBase64Bytes(base64) > MAX_IMAGE_UPLOAD_BYTES) {
        setPickerError(t('imageTooLarge'));
        return;
      }

      clearValidationErrors();
      setImageAttachment({
        uri: asset.uri,
        base64,
        mediaType
      });
    } catch {
      setPickerError(t('imagePickerError'));
    } finally {
      setIsPickingImage(false);
    }
  };

  const handleDiscussionPress = () => {
    if (canSend) {
      handleSend();
      return;
    }

    Alert.alert(t('discussionComingSoonTitle'), t('discussionComingSoonBody'));
  };

  return (
    <View style={styles.wrapper}>
      {imageAttachment ? (
        <View style={styles.attachmentRow}>
          <Image source={{ uri: imageAttachment.uri }} style={styles.attachmentImage} resizeMode="cover" />
          <Text style={styles.attachmentText}>{t('imageAttached')}</Text>
          <Pressable
            style={styles.removeAttachmentButton}
            onPress={() => setImageAttachment(null)}
            accessibilityRole="button"
            accessibilityLabel={t('removeImageA11y')}
          >
            <Text style={styles.removeAttachmentText}>✕</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.container}>
        <Pressable
          style={[styles.leftAction, (disabled || isPickingImage) && styles.disabledButton]}
          disabled={disabled || isPickingImage}
          onPress={handlePickImage}
          accessibilityRole="button"
          accessibilityLabel={t('addButtonA11y')}
        >
          {isPickingImage ? <ActivityIndicator color={theme.colors.textDisabled} /> : <Text style={styles.leftActionText}>+</Text>}
        </Pressable>

        <View style={styles.inputShell}>
          <TextInput
            testID="chat-input"
            style={styles.input}
            value={value}
            onChangeText={(nextValue) => {
              clearValidationErrors();
              setValue(nextValue);
            }}
            placeholder={
              voiceStatus === 'recording'
                ? transcript || t('voiceInputPlaceholder')
                : voiceStatus === 'transcribing'
                  ? t('voiceTranscribing')
                  : t('chatPlaceholder')
            }
            placeholderTextColor={theme.colors.textDisabled}
            multiline
            maxLength={MAX_MESSAGE_LENGTH}
            editable={!disabled}
          />

          {featureFlags.enableVoice ? (
            <Animated.View style={{ transform: [{ scale: pulse }, { translateX: shake }] }}>
              <Pressable
                testID="chat-mic-button"
                style={[
                  styles.micButton,
                  voiceStatus === 'recording' && styles.micRecording,
                  (disabled || voiceStatus === 'transcribing') && styles.disabledButton
                ]}
                onPress={handleVoiceToggle}
                disabled={disabled || voiceStatus === 'transcribing'}
                accessibilityRole="button"
                accessibilityLabel={voiceStatus === 'recording' ? t('micButtonStop') : t('micButtonLabel')}
              >
                {voiceStatus === 'transcribing' ? (
                  <ActivityIndicator color={theme.colors.textDisabled} />
                ) : (
                  <Text style={styles.micText}>{voiceStatus === 'recording' ? '■' : '🎤'}</Text>
                )}
              </Pressable>
            </Animated.View>
          ) : null}
        </View>

        <Pressable
          testID="chat-discussion-button"
          style={[styles.rightAction, disabled && styles.disabledButton]}
          onPress={handleDiscussionPress}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={canSend ? t('sendButtonA11y') : t('discussionButtonA11y')}
        >
          <Text style={styles.rightActionText}>{canSend ? '➤' : '◉'}</Text>
        </Pressable>
      </View>

      {error ? (
        <Text style={styles.errorText} testID="chat-input-error">
          {t(error.code)}
        </Text>
      ) : null}

      {pickerError && !error ? <Text style={styles.errorText}>{pickerError}</Text> : null}

      {voiceError && !error && !pickerError ? (
        <Text style={styles.errorText} testID="chat-input-voice-error">
          {voiceError}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSunken
  },
  attachmentRow: {
    marginHorizontal: theme.spacing.sm,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.xs,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm
  },
  attachmentImage: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: theme.colors.surfaceButton
  },
  attachmentText: {
    flex: 1,
    color: theme.colors.textSecondary,
    fontSize: 13,
    fontWeight: '600'
  },
  removeAttachmentButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceButton
  },
  removeAttachmentText: {
    color: theme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '700'
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.sm,
    backgroundColor: theme.colors.surfaceSunken
  },
  leftAction: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.surfaceButton,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border
  },
  leftActionText: {
    fontSize: 34,
    lineHeight: 36,
    color: theme.colors.textSecondary,
    fontWeight: '300'
  },
  inputShell: {
    flex: 1,
    minHeight: 56,
    maxHeight: 120,
    borderRadius: 28,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingLeft: theme.spacing.md,
    paddingRight: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center'
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 104,
    color: theme.colors.textPrimary,
    fontSize: 16,
    paddingVertical: theme.spacing.sm
  },
  micButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center'
  },
  micRecording: {
    backgroundColor: theme.colors.recordingActive
  },
  micText: {
    color: theme.colors.textDisabled,
    fontSize: 20
  },
  rightAction: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.surfaceDeep,
    justifyContent: 'center',
    alignItems: 'center'
  },
  rightActionText: {
    color: theme.colors.textPrimary,
    fontSize: 22,
    fontWeight: '700'
  },
  disabledButton: {
    opacity: 0.45
  },
  errorText: {
    color: theme.colors.error,
    fontSize: 11,
    paddingHorizontal: theme.spacing.sm,
    paddingBottom: theme.spacing.sm
  }
});
