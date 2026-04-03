jest.mock('expo-image-manipulator', () => ({
  SaveFormat: {
    JPEG: 'jpeg',
    PNG: 'png',
    WEBP: 'webp'
  },
  manipulateAsync: jest.fn()
}));

import { MAX_IMAGE_UPLOAD_BYTES } from '../config/constants';
import { prepareImageForUpload } from './imageUploadPreparation';

function createBase64ForBytes(byteCount: number): string {
  const normalizedBytes = Math.max(1, Math.floor(byteCount));
  return 'A'.repeat(Math.ceil((normalizedBytes * 4) / 3));
}

describe('imageUploadPreparation', () => {
  it('optimizes a large source image under upload limit', async () => {
    const readImageAsBase64 = jest.fn().mockResolvedValue(createBase64ForBytes(8_900_000));
    const manipulateImageAsync = jest
      .fn()
      .mockResolvedValueOnce({
        uri: 'file:///tmp/optimized-step-1.jpg',
        width: 3000,
        height: 2000,
        base64: createBase64ForBytes(3_400_000)
      })
      .mockResolvedValueOnce({
        uri: 'file:///tmp/optimized-final.jpg',
        width: 2400,
        height: 1600,
        base64: createBase64ForBytes(2_700_000)
      });

    const result = await prepareImageForUpload(
      {
        uri: 'file:///tmp/photo.jpg',
        mediaType: 'image/jpeg',
        sourceSizeBytes: 8_900_000,
        width: 4032,
        height: 3024
      },
      {
        readImageAsBase64,
        manipulateImageAsync
      }
    );

    expect(result.mediaType).toBe('image/jpeg');
    expect(result.optimized).toBe(true);
    expect(result.byteSize).toBeLessThanOrEqual(MAX_IMAGE_UPLOAD_BYTES);
    expect(manipulateImageAsync).toHaveBeenCalledTimes(2);
  });

  it('rejects source images larger than 10 MB', async () => {
    const readImageAsBase64 = jest.fn().mockResolvedValue(createBase64ForBytes(2_000_000));
    const manipulateImageAsync = jest.fn();

    await expect(
      prepareImageForUpload(
        {
          uri: 'file:///tmp/too-large.jpg',
          mediaType: 'image/jpeg',
          sourceSizeBytes: 10_500_000,
          width: 4032,
          height: 3024
        },
        {
          readImageAsBase64,
          manipulateImageAsync
        }
      )
    ).rejects.toMatchObject({
      code: 'source_too_large'
    });

    expect(manipulateImageAsync).not.toHaveBeenCalled();
  });

  it('rejects unsupported image media types', async () => {
    const readImageAsBase64 = jest.fn();
    const manipulateImageAsync = jest.fn();

    await expect(
      prepareImageForUpload(
        {
          uri: 'file:///tmp/photo.tiff',
          mediaType: 'image/tiff' as never
        },
        {
          readImageAsBase64,
          manipulateImageAsync
        }
      )
    ).rejects.toMatchObject({
      code: 'unsupported_media_type'
    });
  });

  it('fails when optimization cannot fit image under upload limit', async () => {
    const readImageAsBase64 = jest.fn().mockResolvedValue(createBase64ForBytes(8_100_000));
    const manipulateImageAsync = jest.fn().mockResolvedValue({
      uri: 'file:///tmp/still-too-large.jpg',
      width: 3200,
      height: 2200,
      base64: createBase64ForBytes(3_300_000)
    });

    await expect(
      prepareImageForUpload(
        {
          uri: 'file:///tmp/photo.jpg',
          mediaType: 'image/jpeg',
          sourceSizeBytes: 8_100_000,
          width: 4032,
          height: 3024
        },
        {
          readImageAsBase64,
          manipulateImageAsync
        }
      )
    ).rejects.toMatchObject({
      code: 'optimization_failed'
    });

    expect(manipulateImageAsync).toHaveBeenCalled();
  });
});
