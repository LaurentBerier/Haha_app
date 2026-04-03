import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputKeyPressEventData,
  View
} from 'react-native';
import { MAX_IMAGE_SOURCE_BYTES, MAX_MESSAGE_LENGTH } from '../../config/constants';
import { t } from '../../i18n';
import type { ChatError } from '../../models/ChatError';
import type { ChatImageAttachment, ChatSendPayload } from '../../models/ChatSendPayload';
import type { ClaudeImageMediaType } from '../../services/claudeApiService';
import { impactLight } from '../../services/hapticsService';
import { prepareImageForUpload, PrepareImageUploadError } from '../../services/imageUploadPreparation';
import { theme } from '../../theme';
import type { VoiceConversationStatus } from '../../hooks/useVoiceConversation';
import { resolveChatInputVoiceAction, runChatInputVoiceAction } from './chatInputVoiceAction';
import {
  isChatInputMicActive,
  isChatInputMicPaused,
  shouldShowConversationHint,
  shouldUseOffMicAsset
} from './chatInputMicState';
import micIconSource from '../../../assets/icons/Mic_Icon.png';
import micIconOffSource from '../../../assets/icons/Mic_Icon_off.png';

interface ConversationModeProps {
  enabled: boolean;
  isListening: boolean;
  transcript: string;
  error?: string | null;
  micState?: VoiceConversationStatus;
  hint?: string | null;
  onToggle: () => void;
  onPauseListening?: () => void;
  onResumeListening?: () => void;
  onTypingStateChange?: (hasTypedText: boolean) => void;
}

interface ChatInputProps {
  onSend: (payload: ChatSendPayload) => ChatError | null;
  disabled?: boolean;
  allowImage?: boolean;
  conversationMode?: ConversationModeProps;
  onInputFocusChange?: (isFocused: boolean) => void;
}

interface ChatImageAttachmentDraft {
  uri: string;
  mediaType: ClaudeImageMediaType;
  fileSizeBytes: number | null;
  widthPx: number | null;
  heightPx: number | null;
}

const IMAGE_MEDIA_TYPES = new Set<ClaudeImageMediaType>(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const USE_NATIVE_DRIVER = Platform.OS !== 'web';
const IMAGE_PICKER_OPTIONS = {
  mediaTypes: ['images'] as ImagePicker.MediaType[],
  allowsEditing: false,
  quality: 1,
  base64: false,
  exif: false
};

type ImageSourceOption = 'library' | 'camera';

function useVoiceAnimations(isListening: boolean) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isListening) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.08, duration: 380, useNativeDriver: USE_NATIVE_DRIVER }),
          Animated.timing(pulse, { toValue: 1, duration: 380, useNativeDriver: USE_NATIVE_DRIVER })
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

function inferImageMediaTypeFromUri(uri: string | null | undefined): ClaudeImageMediaType | null {
  if (!uri) {
    return null;
  }

  const normalizedUri = uri.toLowerCase();
  if (normalizedUri.endsWith('.jpg') || normalizedUri.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (normalizedUri.endsWith('.png')) {
    return 'image/png';
  }
  if (normalizedUri.endsWith('.webp')) {
    return 'image/webp';
  }
  if (normalizedUri.endsWith('.gif')) {
    return 'image/gif';
  }

  return null;
}

function resolveImagePreparationErrorMessage(error: unknown): string {
  if (!(error instanceof PrepareImageUploadError)) {
    return t('imagePickerError');
  }

  switch (error.code) {
    case 'unsupported_media_type':
      return t('imagePickerUnsupported');
    case 'source_too_large':
      return t('imageTooLarge');
    case 'optimization_failed':
      return t('imageOptimizationFailed');
    case 'read_failed':
    default:
      return t('imagePickerError');
  }
}

export function ChatInput({
  onSend,
  disabled = false,
  allowImage = true,
  conversationMode,
  onInputFocusChange
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const [imageAttachment, setImageAttachment] = useState<ChatImageAttachmentDraft | null>(null);
  const [isPickingImage, setIsPickingImage] = useState(false);
  const [isEncodingImage, setIsEncodingImage] = useState(false);
  const [isImageSourceModalVisible, setIsImageSourceModalVisible] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const sendScale = useRef(new Animated.Value(1)).current;
  const isConversationEnabled = Boolean(conversationMode?.enabled);
  const micState = conversationMode?.micState ?? 'off';
  const isConversationMicActive = isChatInputMicActive(micState);
  const isConversationPaused = isChatInputMicPaused(isConversationEnabled, micState);
  const conversationTranscript = conversationMode?.transcript.trim() ?? '';
  const conversationError = conversationMode?.error ?? null;
  const conversationHint = conversationMode?.hint ?? null;
  const shouldShowMicHint = shouldShowConversationHint({
    hint: conversationHint,
    disabled,
    hasConversationError: Boolean(conversationError),
    hasValidationError: Boolean(error),
    hasPickerError: Boolean(pickerError)
  });
  const shouldUseOffMic = shouldUseOffMicAsset(isConversationEnabled, micState);
  const { pulse } = useVoiceAnimations(isConversationMicActive);

  const trimmed = value.trim();
  const hasText = trimmed.length > 0;
  const hasImage = allowImage && Boolean(imageAttachment);
  const isBusyWithImage = isPickingImage || isEncodingImage;
  const canSend = (hasText || hasImage) && !disabled && !isEncodingImage;

  useEffect(() => {
    conversationMode?.onTypingStateChange?.(isConversationEnabled && hasText);
  }, [conversationMode, hasText, isConversationEnabled]);

  useEffect(() => {
    if (!allowImage && imageAttachment) {
      setImageAttachment(null);
    }
  }, [allowImage, imageAttachment]);

  useEffect(() => {
    if (!allowImage && isImageSourceModalVisible) {
      setIsImageSourceModalVisible(false);
    }
  }, [allowImage, isImageSourceModalVisible]);

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
        const prepared = await prepareImageForUpload({
          uri: imageAttachment.uri,
          mediaType: imageAttachment.mediaType,
          sourceSizeBytes: imageAttachment.fileSizeBytes,
          width: imageAttachment.widthPx,
          height: imageAttachment.heightPx
        });

        preparedImage = {
          uri: prepared.uri,
          mediaType: prepared.mediaType,
          base64: prepared.base64
        };
      } catch (prepareError) {
        setPickerError(resolveImagePreparationErrorMessage(prepareError));
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

  const handleImageSelection = (asset: ImagePicker.ImagePickerAsset) => {
    const mediaType = normalizeImageMediaType(asset.mimeType) ?? inferImageMediaTypeFromUri(asset.uri);
    const fileSizeBytes = typeof asset.fileSize === 'number' && Number.isFinite(asset.fileSize) ? asset.fileSize : null;

    if (!mediaType) {
      setPickerError(t('imagePickerUnsupported'));
      return;
    }

    if (fileSizeBytes !== null && fileSizeBytes > MAX_IMAGE_SOURCE_BYTES) {
      setPickerError(t('imageTooLarge'));
      return;
    }

    clearValidationErrors();
    setImageAttachment({
      uri: asset.uri,
      mediaType,
      fileSizeBytes,
      widthPx: typeof asset.width === 'number' && Number.isFinite(asset.width) ? asset.width : null,
      heightPx: typeof asset.height === 'number' && Number.isFinite(asset.height) ? asset.height : null
    });
  };

  const handlePickImageFrom = async (source: ImageSourceOption) => {
    if (!allowImage || disabled || isBusyWithImage) {
      return;
    }

    setIsImageSourceModalVisible(false);
    setIsPickingImage(true);
    setPickerError(null);

    try {
      const permission =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setPickerError(source === 'camera' ? t('cameraPermissionDenied') : t('imagePickerPermissionDenied'));
        return;
      }

      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync(IMAGE_PICKER_OPTIONS)
          : await ImagePicker.launchImageLibraryAsync(IMAGE_PICKER_OPTIONS);

      if (result.canceled || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      if (!asset) {
        return;
      }

      handleImageSelection(asset);
    } catch {
      setPickerError(t('imagePickerError'));
    } finally {
      setIsPickingImage(false);
    }
  };

  const handlePickImage = () => {
    if (!allowImage || disabled || isBusyWithImage) {
      return;
    }

    clearValidationErrors();
    setIsImageSourceModalVisible(true);
  };

  const handleRightActionPress = () => {
    const action = resolveChatInputVoiceAction({
      canSend,
      hasConversationMode: Boolean(conversationMode),
      isConversationEnabled,
      micState
    });

    if (action === 'send') {
      Animated.sequence([
        Animated.timing(sendScale, { toValue: 0.9, duration: 70, useNativeDriver: USE_NATIVE_DRIVER }),
        Animated.timing(sendScale, { toValue: 1, duration: 110, useNativeDriver: USE_NATIVE_DRIVER })
      ]).start();
      void handleSend();
      return;
    }

    if (!conversationMode || action === 'noop') {
      return;
    }

    void impactLight();
    runChatInputVoiceAction(action, {
      onSend: () => {},
      onEnableAndListen: () => {
        conversationMode.onToggle();
        conversationMode.onResumeListening?.();
      },
      onPauseListening: () => {
        conversationMode.onPauseListening?.();
      },
      onResumeListening: () => {
        conversationMode.onResumeListening?.();
      }
    });
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
      <Modal
        transparent
        animationType="fade"
        visible={isImageSourceModalVisible}
        onRequestClose={() => setIsImageSourceModalVisible(false)}
      >
        <Pressable style={styles.imageSourceBackdrop} onPress={() => setIsImageSourceModalVisible(false)}>
          <Pressable style={styles.imageSourceCard} onPress={() => {}}>
            <Text style={styles.imageSourceTitle}>{t('imageSourcePickerTitle')}</Text>
            <Pressable
              style={styles.imageSourceButton}
              onPress={() => {
                void handlePickImageFrom('library');
              }}
            >
              <Text style={styles.imageSourceButtonText}>{t('imageSourceLibrary')}</Text>
            </Pressable>
            <Pressable
              style={styles.imageSourceButton}
              onPress={() => {
                void handlePickImageFrom('camera');
              }}
            >
              <Text style={styles.imageSourceButtonText}>{t('imageSourceCamera')}</Text>
            </Pressable>
            <Pressable
              style={[styles.imageSourceButton, styles.imageSourceCancelButton]}
              onPress={() => setIsImageSourceModalVisible(false)}
            >
              <Text style={[styles.imageSourceButtonText, styles.imageSourceCancelText]}>{t('cancel')}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

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

      {shouldShowMicHint ? (
        <View style={styles.pausedHintRow}>
          <Text style={styles.pausedHint} testID="chat-input-mic-paused-hint">
            {conversationHint}
          </Text>
        </View>
      ) : null}

      <View style={styles.container}>
        {allowImage ? (
          <Pressable
            style={[styles.leftAction, (disabled || isBusyWithImage) && styles.disabledButton]}
            disabled={disabled || isBusyWithImage}
            onPress={handlePickImage}
            accessibilityRole="button"
            accessibilityLabel={t('addButtonA11y')}
          >
            {isBusyWithImage ? (
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
            onFocus={() => onInputFocusChange?.(true)}
            onBlur={() => onInputFocusChange?.(false)}
            onChangeText={(nextValue) => {
              clearValidationErrors();
              setValue(nextValue);
            }}
            placeholder={
              isConversationMicActive
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
              !canSend && !isConversationEnabled && styles.conversationOff,
              !canSend && isConversationPaused && styles.conversationPaused
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
                source={shouldUseOffMic ? micIconOffSource : micIconSource}
                style={[
                  styles.micIcon,
                  shouldUseOffMic && styles.micIconOff
                ]}
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
  imageSourceBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.lg
  },
  imageSourceCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    gap: theme.spacing.sm
  },
  imageSourceTitle: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '700'
  },
  imageSourceButton: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceButton,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md
  },
  imageSourceButtonText: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '600'
  },
  imageSourceCancelButton: {
    backgroundColor: theme.colors.surfaceSunken
  },
  imageSourceCancelText: {
    color: theme.colors.textSecondary
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
  conversationPaused: {
    backgroundColor: theme.colors.surfaceRaised
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
  micIconOff: {
    opacity: 0.98
  },
  disabledButton: {
    opacity: 0.45
  },
  errorText: {
    color: theme.colors.error,
    fontSize: 11,
    paddingHorizontal: theme.spacing.sm,
    paddingBottom: theme.spacing.sm
  },
  pausedHintRow: {
    paddingHorizontal: theme.spacing.sm,
    paddingTop: theme.spacing.xs,
    paddingBottom: 2,
    alignItems: 'flex-end'
  },
  pausedHint: {
    color: theme.colors.textSecondary,
    fontSize: 11,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface
  }
});
