import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';

export type MemeMediaErrorCode =
  | 'invalid_image_uri'
  | 'missing_cache_directory'
  | 'permission_denied'
  | 'share_unavailable'
  | 'share_cancelled'
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

function decodeBase64ToBytes(base64: string): Uint8Array | null {
  if (typeof globalThis.atob !== 'function') {
    return null;
  }

  try {
    const binary = globalThis.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function createWebShareFile(params: ShareMemeParams): File | null {
  if (typeof File !== 'function') {
    return null;
  }

  const normalizedUri = params.imageUri.trim();
  if (!normalizedUri) {
    return null;
  }

  const dataInfo = parseDataUri(normalizedUri);
  if (!dataInfo) {
    return null;
  }

  const bytes = decodeBase64ToBytes(dataInfo.base64);
  if (!bytes) {
    return null;
  }

  const mimeType = dataInfo.mimeType || params.mimeType || 'image/png';
  const fileName = buildFileName('meme-share', mimeType);
  return new File([bytes], fileName, { type: mimeType });
}

function isShareCancelError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = 'code' in error && typeof error.code === 'string' ? error.code.trim() : '';
  if (code === 'ERR_SHARING_CANCELED') {
    return true;
  }

  const name = 'name' in error && typeof error.name === 'string' ? error.name.trim() : '';
  return name === 'AbortError' || name === 'NotAllowedError';
}

async function tryWebNativeShare(params: ShareMemeParams): Promise<MemeMediaResult | null> {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
    return null;
  }

  const title = params.dialogTitle?.trim() || 'Meme';
  const webShareFile = createWebShareFile(params);

  try {
    if (webShareFile) {
      const canShareFiles =
        typeof navigator.canShare !== 'function' || navigator.canShare({ files: [webShareFile] });
      if (canShareFiles) {
        await navigator.share({
          title,
          files: [webShareFile]
        });
        return { ok: true };
      }
    }

    const normalizedUri = params.imageUri.trim();
    if (normalizedUri.startsWith('http://') || normalizedUri.startsWith('https://')) {
      await navigator.share({
        title,
        url: normalizedUri
      });
      return { ok: true };
    }

    await navigator.share({
      title,
      text: title
    });
    return { ok: true };
  } catch (error) {
    if (isShareCancelError(error)) {
      return { ok: false, code: 'share_cancelled' };
    }
    return null;
  }
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

      try {
        await Sharing.shareAsync(localFile.fileUri, {
          mimeType: localFile.mimeType,
          dialogTitle: params.dialogTitle
        });
        return { ok: true };
      } catch (error) {
        if (isShareCancelError(error)) {
          return { ok: false, code: 'share_cancelled' };
        }
        throw error;
      }
    }

    const webNativeShareResult = await tryWebNativeShare({
      imageUri: normalizedUri,
      mimeType: params.mimeType,
      dialogTitle: params.dialogTitle
    });
    if (webNativeShareResult) {
      return webNativeShareResult;
    }

    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      try {
        await Sharing.shareAsync(normalizedUri, {
          dialogTitle: params.dialogTitle
        });
        return { ok: true };
      } catch (error) {
        if (isShareCancelError(error)) {
          return { ok: false, code: 'share_cancelled' };
        }
        // Continue with resilient web fallbacks below.
      }
    }

    if (typeof window !== 'undefined') {
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
