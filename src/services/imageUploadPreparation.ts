import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { MAX_IMAGE_SOURCE_BYTES, MAX_IMAGE_UPLOAD_BYTES } from '../config/constants';
import type { ClaudeImageMediaType } from './claudeApiService';

const SUPPORTED_IMAGE_MEDIA_TYPES = new Set<ClaudeImageMediaType>(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const JPEG_MEDIA_TYPE: ClaudeImageMediaType = 'image/jpeg';
const QUALITY_STEPS = [0.82, 0.72, 0.62, 0.52, 0.42, 0.32];
const RESIZE_LONG_EDGE_STEPS = [2800, 2400, 2000, 1600, 1280, 1080];

type PrepareImageUploadErrorCode =
  | 'unsupported_media_type'
  | 'source_too_large'
  | 'read_failed'
  | 'optimization_failed';

type ManipulateImageAsync = typeof manipulateAsync;

interface PrepareImageForUploadDependencies {
  readImageAsBase64?: (uri: string) => Promise<string>;
  manipulateImageAsync?: ManipulateImageAsync;
}

export interface PrepareImageForUploadInput {
  uri: string;
  mediaType: ClaudeImageMediaType;
  sourceSizeBytes?: number | null;
  width?: number | null;
  height?: number | null;
}

export interface PreparedImageUpload {
  uri: string;
  base64: string;
  mediaType: ClaudeImageMediaType;
  byteSize: number;
  optimized: boolean;
}

export class PrepareImageUploadError extends Error {
  readonly code: PrepareImageUploadErrorCode;

  constructor(code: PrepareImageUploadErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function estimateBase64Bytes(base64: string): number {
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

export async function readImageAsBase64(uri: string): Promise<string> {
  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error(`Failed to read image attachment (${response.status}).`);
  }
  const blob = await response.blob();
  return await blobToBase64(blob);
}

function resolveResizeAction(
  targetLongEdge: number,
  width: number | null,
  height: number | null
): Array<{ resize: { width?: number; height?: number } }> {
  if (!width || !height) {
    return [];
  }

  const longEdge = Math.max(width, height);
  if (longEdge <= targetLongEdge) {
    return [];
  }

  if (width >= height) {
    return [{ resize: { width: targetLongEdge } }];
  }
  return [{ resize: { height: targetLongEdge } }];
}

function toFiniteSize(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function resolveSourceSizeBytes(providedSizeBytes: number | null | undefined, base64: string): number {
  const normalizedProvidedSize = toFiniteSize(providedSizeBytes);
  if (normalizedProvidedSize !== null) {
    return normalizedProvidedSize;
  }
  return estimateBase64Bytes(base64);
}

async function optimizeToUploadLimit(
  input: PrepareImageForUploadInput,
  deps: Required<PrepareImageForUploadDependencies>
): Promise<PreparedImageUpload | null> {
  const width = toFiniteSize(input.width);
  const height = toFiniteSize(input.height);
  const sourceLongEdge = width && height ? Math.max(width, height) : null;
  const longEdgeCandidates = [
    0,
    ...RESIZE_LONG_EDGE_STEPS.filter((targetLongEdge) => (sourceLongEdge ? targetLongEdge < sourceLongEdge : true))
  ];

  for (const longEdgeCandidate of longEdgeCandidates) {
    const resizeActions =
      longEdgeCandidate > 0 ? resolveResizeAction(longEdgeCandidate, width, height) : [];

    // Binary search for the highest quality that fits under the upload limit,
    // rather than iterating all qualities sequentially (reduces manipulateAsync
    // calls from up to 6 per size to ~3).
    let lo = 0;
    let hi = QUALITY_STEPS.length - 1;
    let bestForSize: PreparedImageUpload | null = null;

    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const quality = QUALITY_STEPS[mid]!;
      const optimized = await deps.manipulateImageAsync(input.uri, resizeActions, {
        base64: true,
        compress: quality,
        format: SaveFormat.JPEG
      });
      if (!optimized) {
        lo = mid + 1;
        continue;
      }
      const base64 = typeof optimized.base64 === 'string' ? optimized.base64.trim() : '';
      if (!base64) {
        // Can't evaluate this quality — try lower quality.
        lo = mid + 1;
        continue;
      }

      const byteSize = estimateBase64Bytes(base64);
      if (byteSize <= MAX_IMAGE_UPLOAD_BYTES) {
        bestForSize = {
          uri: optimized.uri,
          base64,
          mediaType: JPEG_MEDIA_TYPE,
          byteSize,
          optimized: true
        };
        // Try higher quality (lower index = higher quality).
        hi = mid - 1;
      } else {
        // Too large — try lower quality (higher index).
        lo = mid + 1;
      }
    }

    if (bestForSize) {
      return bestForSize;
    }
  }

  return null;
}

export async function prepareImageForUpload(
  input: PrepareImageForUploadInput,
  dependencies?: PrepareImageForUploadDependencies
): Promise<PreparedImageUpload> {
  if (!SUPPORTED_IMAGE_MEDIA_TYPES.has(input.mediaType)) {
    throw new PrepareImageUploadError('unsupported_media_type', 'Unsupported image media type.');
  }

  const deps: Required<PrepareImageForUploadDependencies> = {
    readImageAsBase64: dependencies?.readImageAsBase64 ?? readImageAsBase64,
    manipulateImageAsync: dependencies?.manipulateImageAsync ?? manipulateAsync
  };

  let base64: string;
  try {
    base64 = (await deps.readImageAsBase64(input.uri)).trim();
  } catch {
    throw new PrepareImageUploadError('read_failed', 'Failed to read image file.');
  }

  if (!base64) {
    throw new PrepareImageUploadError('read_failed', 'Image file is empty.');
  }

  const sourceSizeBytes = resolveSourceSizeBytes(input.sourceSizeBytes, base64);
  if (sourceSizeBytes > MAX_IMAGE_SOURCE_BYTES) {
    throw new PrepareImageUploadError('source_too_large', 'Image source file is too large.');
  }

  const byteSize = estimateBase64Bytes(base64);
  if (!Number.isFinite(byteSize) || byteSize <= 0) {
    throw new PrepareImageUploadError('read_failed', 'Invalid image payload.');
  }

  if (byteSize <= MAX_IMAGE_UPLOAD_BYTES) {
    return {
      uri: input.uri,
      base64,
      mediaType: input.mediaType,
      byteSize,
      optimized: false
    };
  }

  const optimized = await optimizeToUploadLimit(input, deps);
  if (!optimized) {
    throw new PrepareImageUploadError(
      'optimization_failed',
      'Could not optimize image under upload byte limit.'
    );
  }

  return optimized;
}
