import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputKeyPressEventData,
  View
} from 'react-native';
import { MAX_IMAGE_UPLOAD_BYTES, MAX_MESSAGE_LENGTH } from '../../config/constants';
import { t } from '../../i18n';
import type { ChatError } from '../../models/ChatError';
import type { ChatImageAttachment, ChatSendPayload } from '../../models/ChatSendPayload';
import type { ClaudeImageMediaType } from '../../services/claudeApiService';
import { impactLight } from '../../services/hapticsService';
import { theme } from '../../theme';
import micIconSource from '../../../assets/icons/Mic_Icon.png';

interface ConversationModeProps {
  enabled: boolean;
  isListening: boolean;
  transcript: string;
  error?: string | null;
  isPlaying?: boolean;
  onToggle: () => void;
  onInterrupt?: () => void;
  onTypingStateChange?: (hasTypedText: boolean) => void;
}

interface ChatInputProps {
  onSend: (payload: ChatSendPayload) => ChatError | null;
  disabled?: boolean;
  allowImage?: boolean;
  conversationMode?: ConversationModeProps;
}

interface ChatImageAttachmentDraft {
  uri: string;
  mediaType: ClaudeImageMediaType;
  fileSizeBytes: number | null;
}

const IMAGE_MEDIA_TYPES = new Set<ClaudeImageMediaType>(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function useVoiceAnimations(isListening: boolean) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isListening) {
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
  }, [isListening, pulse]);

  return { pulse };
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

async function blobToBase64(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIndex = result.indexOf(',');
      if (commaIndex < 0) {
        reject(new Error('Invalid data URL.'));
        return;
      }
      resolve(result.slice(commaIndex + 1));
    };
    reader.onerror = () => {
      reject(new Error('Failed to read image file.'));
    };
    reader.readAsDataURL(blob);
  });
}

async function readImageAsBase64(uri: string): Promise<string> {
  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error(`Failed to read image attachment (${response.status}).`);
  }
  const blob = await response.blob();
  return await blobToBase64(blob);
}

export function ChatInput({ onSend, disabled = false, allowImage = true, conversationMode }: ChatInputProps) {
  const [value, setValue] = useState('');
  const [imageAttachment, setImageAttachment] = useState<ChatImageAttachmentDraft | null>(null);
  const [isPickingImage, setIsPickingImage] = useState(false);
  const [isEncodingImage, setIsEncodingImage] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const sendScale = useRef(new Animated.Value(1)).current;
  const isConversationEnabled = Boolean(conversationMode?.enabled);
  const isConversationListening = Boolean(conversationMode?.enabled && conversationMode.isListening);
  const isConversationPlaying = Boolean(conversationMode?.enabled && conversationMode.isPlaying);
  const conversationTranscript = conversationMode?.transcript.trim() ?? '';
  const conversationError = conversationMode?.error ?? null;
  const { pulse } = useVoiceAnimations(isConversationListening);

  const trimmed = value.trim();
  const hasText = trimmed.length > 0;
  const hasImage = allowImage && Boolean(imageAttachment);
  const canSend = (hasText || hasImage) && !disabled && !isEncodingImage;

  useEffect(() => {
    conversationMode?.onTypingStateChange?.(isConversationEnabled && hasText);
  }, [conversationMode, hasText, isConversationEnabled]);

  useEffect(() => {
    if (!allowImage && imageAttachment) {
      setImageAttachment(null);
    }
  }, [allowImage, imageAttachment]);

  const clearValidationErrors = () => {
    if (error) {
      setError(null);
    }
    if (pickerError) {
      setPickerError(null);
    }
  };

  const handleSend = async () => {
    if (!hasText && !hasImage) {
      return;
    }

    let preparedImage: ChatImageAttachment | null = null;
    if (allowImage && imageAttachment) {
      setIsEncodingImage(true);
      try {
        const base64 = await readImageAsBase64(imageAttachment.uri);
        if (!base64) {
          setPickerError(t('imagePickerError'));
          return;
        }

        const estimatedBytes = estimateBase64Bytes(base64);
        if (estimatedBytes > MAX_IMAGE_UPLOAD_BYTES) {
          setPickerError(t('imageTooLarge'));
          return;
        }

        preparedImage = {
          uri: imageAttachment.uri,
          mediaType: imageAttachment.mediaType,
          base64
        };
      } catch {
        setPickerError(t('imagePickerError'));
        return;
      } finally {
        setIsEncodingImage(false);
      }
    }

    void impactLight();
    const sendError = onSend({ text: trimmed, image: preparedImage });
    if (sendError) {
      setError(sendError);
      return;
    }

    setError(null);
    setPickerError(null);
    setValue('');
    setImageAttachment(null);
  };

  const handlePickImage = async () => {
    if (!allowImage || disabled || isPickingImage) {
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
        base64: false,
        exif: false
      });

      if (result.canceled || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      if (!asset) {
        return;
      }

      const mediaType = normalizeImageMediaType(asset.mimeType);
      const fileSizeBytes = typeof asset.fileSize === 'number' && Number.isFinite(asset.fileSize) ? asset.fileSize : null;

      if (!mediaType) {
        setPickerError(t('imagePickerUnsupported'));
        return;
      }

      if (fileSizeBytes !== null && fileSizeBytes > MAX_IMAGE_UPLOAD_BYTES) {
        setPickerError(t('imageTooLarge'));
        return;
      }

      clearValidationErrors();
      setImageAttachment({
        uri: asset.uri,
        mediaType,
        fileSizeBytes
      });
    } catch {
      setPickerError(t('imagePickerError'));
    } finally {
      setIsPickingImage(false);
    }
  };

  const handleRightActionPress = () => {
    if (canSend) {
      Animated.sequence([
        Animated.timing(sendScale, { toValue: 0.9, duration: 70, useNativeDriver: true }),
        Animated.timing(sendScale, { toValue: 1, duration: 110, useNativeDriver: true })
      ]).start();
      void handleSend();
      return;
    }

    if (!conversationMode) {
      return;
    }

    void impactLight();
    if (!isConversationEnabled) {
      conversationMode.onToggle();
      return;
    }

    if (isConversationPlaying && conversationMode.onInterrupt) {
      conversationMode.onInterrupt();
      return;
    }

    conversationMode.onToggle();
  };

  const handleInputKeyPress = (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    if (Platform.OS !== 'web') {
      return;
    }

    const webEvent = event.nativeEvent as TextInputKeyPressEventData & {
      isComposing?: boolean;
      shiftKey?: boolean;
    };

    if (webEvent.isComposing) {
      return;
    }

    if (webEvent.key !== 'Enter' || webEvent.shiftKey) {
      return;
    }

    (event as unknown as { preventDefault?: () => void }).preventDefault?.();

    if (!canSend) {
      return;
    }

    void handleSend();
  };

  return (
    <View style={styles.wrapper}>
      {allowImage && imageAttachment ? (
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
        {allowImage ? (
          <Pressable
            style={[styles.leftAction, (disabled || isPickingImage || isEncodingImage) && styles.disabledButton]}
            disabled={disabled || isPickingImage || isEncodingImage}
            onPress={handlePickImage}
            accessibilityRole="button"
            accessibilityLabel={t('addButtonA11y')}
          >
            {isPickingImage || isEncodingImage ? (
              <ActivityIndicator color={theme.colors.textDisabled} />
            ) : (
              <Text style={styles.leftActionText}>+</Text>
            )}
          </Pressable>
        ) : null}

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
              isConversationListening
                ? conversationTranscript || t('voiceInputPlaceholder')
                : t('chatPlaceholder')
            }
            placeholderTextColor={theme.colors.textDisabled}
            multiline
            maxLength={MAX_MESSAGE_LENGTH}
            editable={!disabled}
            onKeyPress={handleInputKeyPress}
          />
        </View>

        <Animated.View
          style={{
            transform: [{ scale: canSend ? sendScale : pulse }]
          }}
        >
          <Pressable
            testID="chat-discussion-button"
            style={[
              styles.rightAction,
              (disabled || isEncodingImage) && styles.disabledButton,
              !canSend && !isConversationEnabled && styles.conversationOff
            ]}
            onPress={handleRightActionPress}
            disabled={disabled || isEncodingImage}
            accessibilityRole="button"
            accessibilityLabel={canSend ? t('sendButtonA11y') : t('micButtonLabel')}
          >
            {canSend ? (
              <Text style={styles.rightActionText}>➤</Text>
            ) : (
              <Image
                source={micIconSource}
                style={[styles.micIcon, !isConversationEnabled && styles.micIconDisabled]}
                resizeMode="contain"
              />
            )}
          </Pressable>
        </Animated.View>
      </View>

      {error ? (
        <Text style={styles.errorText} testID="chat-input-error">
          {t(error.code)}
        </Text>
      ) : null}

      {pickerError && !error ? <Text style={styles.errorText}>{pickerError}</Text> : null}

      {conversationError && !error && !pickerError ? (
        <Text style={styles.errorText} testID="chat-input-voice-error">
          {conversationError}
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
    borderRadius: 12,
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
    gap: theme.spacing.xs + 2,
    paddingHorizontal: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.sm,
    backgroundColor: theme.colors.surfaceSunken
  },
  leftAction: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: theme.colors.surfaceButton,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border
  },
  leftActionText: {
    fontSize: 30,
    lineHeight: 32,
    color: theme.colors.textSecondary,
    fontWeight: '300'
  },
  inputShell: {
    flex: 1,
    minHeight: 50,
    maxHeight: 120,
    borderRadius: 25,
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
    minHeight: 36,
    maxHeight: 104,
    color: theme.colors.textPrimary,
    fontSize: 16,
    paddingVertical: theme.spacing.sm
  },
  rightAction: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.surfaceDeep,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden'
  },
  conversationOff: {
    backgroundColor: theme.colors.surfaceDeep
  },
  rightActionText: {
    color: theme.colors.textPrimary,
    fontSize: 20,
    fontWeight: '700'
  },
  micIcon: {
    width: 36,
    height: 36
  },
  micIconDisabled: {
    opacity: 0.35
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
