import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';

export type MemeMediaErrorCode =
  | 'invalid_image_uri'
  | 'missing_cache_directory'
  | 'permission_denied'
  | 'share_unavailable'
  | 'save_failed'
  | 'share_failed';

interface MemeMediaResult {
  ok: boolean;
  code?: MemeMediaErrorCode;
}

interface SaveMemeParams {
  imageUri: string;
  mimeType?: string;
  fileNameBase?: string;
}

interface ShareMemeParams {
  imageUri: string;
  mimeType?: string;
  dialogTitle?: string;
}

const DATA_URI_PATTERN = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/;

function mimeTypeToExtension(mimeType: string): string {
  const normalized = mimeType.toLowerCase().trim();
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') {
    return 'jpg';
  }
  if (normalized === 'image/webp') {
    return 'webp';
  }
  if (normalized === 'image/gif') {
    return 'gif';
  }
  return 'png';
}

function buildFileName(base: string, mimeType: string): string {
  const stamp = Date.now();
  const safeBase = base.trim() || 'meme';
  const extension = mimeTypeToExtension(mimeType);
  return `${safeBase}-${stamp}.${extension}`;
}

function parseDataUri(uri: string): { mimeType: string; base64: string } | null {
  const match = uri.match(DATA_URI_PATTERN);
  if (!match || !match[1] || !match[2]) {
    return null;
  }

  return {
    mimeType: match[1],
    base64: match[2]
  };
}

async function ensureNativeFileUri(params: SaveMemeParams): Promise<{ fileUri: string; mimeType: string } | null> {
  const cacheDirectory = FileSystem.cacheDirectory;
  if (!cacheDirectory) {
    return null;
  }

  const normalizedUri = params.imageUri.trim();
  if (!normalizedUri) {
    return null;
  }

  if (normalizedUri.startsWith('file://')) {
    return {
      fileUri: normalizedUri,
      mimeType: params.mimeType?.trim() || 'image/png'
    };
  }

  const fromDataUri = parseDataUri(normalizedUri);
  if (fromDataUri) {
    const fileName = buildFileName(params.fileNameBase ?? 'meme', fromDataUri.mimeType);
    const fileUri = `${cacheDirectory}${fileName}`;
    await FileSystem.writeAsStringAsync(fileUri, fromDataUri.base64, {
      encoding: FileSystem.EncodingType.Base64
    });
    return {
      fileUri,
      mimeType: fromDataUri.mimeType
    };
  }

  if (normalizedUri.startsWith('http://') || normalizedUri.startsWith('https://')) {
    const mimeType = params.mimeType?.trim() || 'image/png';
    const fileName = buildFileName(params.fileNameBase ?? 'meme', mimeType);
    const fileUri = `${cacheDirectory}${fileName}`;
    await FileSystem.downloadAsync(normalizedUri, fileUri);
    return {
      fileUri,
      mimeType
    };
  }

  return null;
}

function triggerWebDownload(uri: string, fileName: string): void {
  const anchor = document.createElement('a');
  anchor.href = uri;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

export async function saveMemeImage(params: SaveMemeParams): Promise<MemeMediaResult> {
  try {
    const normalizedUri = params.imageUri.trim();
    if (!normalizedUri) {
      return { ok: false, code: 'invalid_image_uri' };
    }

    if (Platform.OS === 'web') {
      const dataInfo = parseDataUri(normalizedUri);
      const mimeType = dataInfo?.mimeType ?? params.mimeType ?? 'image/png';
      const fileName = buildFileName(params.fileNameBase ?? 'meme', mimeType);
      triggerWebDownload(normalizedUri, fileName);
      return { ok: true };
    }

    const permission = await MediaLibrary.requestPermissionsAsync();
    if (!permission.granted) {
      return { ok: false, code: 'permission_denied' };
    }

    const localFile = await ensureNativeFileUri(params);
    if (!localFile) {
      return { ok: false, code: 'invalid_image_uri' };
    }

    await MediaLibrary.saveToLibraryAsync(localFile.fileUri);
    return { ok: true };
  } catch {
    return { ok: false, code: 'save_failed' };
  }
}

export async function shareMemeImage(params: ShareMemeParams): Promise<MemeMediaResult> {
  try {
    const normalizedUri = params.imageUri.trim();
    if (!normalizedUri) {
      return { ok: false, code: 'invalid_image_uri' };
    }

    if (Platform.OS !== 'web') {
      const localFile = await ensureNativeFileUri({
        imageUri: normalizedUri,
        mimeType: params.mimeType,
        fileNameBase: 'meme-share'
      });
      if (!localFile) {
        return { ok: false, code: 'invalid_image_uri' };
      }

      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        return { ok: false, code: 'share_unavailable' };
      }

      await Sharing.shareAsync(localFile.fileUri, {
        mimeType: localFile.mimeType,
        dialogTitle: params.dialogTitle
      });
      return { ok: true };
    }

    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      try {
        await Sharing.shareAsync(normalizedUri, {
          dialogTitle: params.dialogTitle
        });
        return { ok: true };
      } catch {
        // Continue with resilient web fallbacks below.
      }
    }

    if (typeof window !== 'undefined') {
      try {
        if (typeof document !== 'undefined') {
          const dataInfo = parseDataUri(normalizedUri);
          const mimeType = dataInfo?.mimeType ?? params.mimeType ?? 'image/png';
          const fileName = buildFileName('meme-share', mimeType);
          triggerWebDownload(normalizedUri, fileName);
          return { ok: true };
        }
      } catch {
        // Last fallback below.
      }

      try {
        window.location.href = `mailto:?subject=${encodeURIComponent('Meme')}`;
        return { ok: true };
      } catch {
        return { ok: false, code: 'share_unavailable' };
      }
    }

    return { ok: false, code: 'share_unavailable' };
  } catch {
    return { ok: false, code: 'share_failed' };
  }
}
