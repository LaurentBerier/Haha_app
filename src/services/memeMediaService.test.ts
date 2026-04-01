const mockWriteAsStringAsync = jest.fn<Promise<void>, unknown[]>(async () => undefined);
const mockDownloadAsync = jest.fn<Promise<void>, unknown[]>(async () => undefined);
const mockRequestPermissionsAsync = jest.fn<Promise<{ granted: boolean }>, []>(async () => ({ granted: true }));
const mockSaveToLibraryAsync = jest.fn<Promise<void>, [string]>(async () => undefined);
const mockSharingAvailableAsync = jest.fn<Promise<boolean>, []>(async () => true);
const mockShareAsync = jest.fn<Promise<void>, unknown[]>(async () => undefined);

jest.mock('react-native', () => ({
  Platform: {
    OS: 'ios'
  }
}));

jest.mock('expo-file-system', () => ({
  cacheDirectory: 'file:///cache/',
  writeAsStringAsync: (...args: unknown[]) => mockWriteAsStringAsync(...args),
  downloadAsync: (...args: unknown[]) => mockDownloadAsync(...args),
  EncodingType: {
    Base64: 'base64'
  }
}));

jest.mock('expo-media-library', () => ({
  requestPermissionsAsync: () => mockRequestPermissionsAsync(),
  saveToLibraryAsync: (...args: [string]) => mockSaveToLibraryAsync(...args)
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => mockSharingAvailableAsync(),
  shareAsync: (...args: unknown[]) => mockShareAsync(...args)
}));

import { saveMemeImage, shareMemeImage } from './memeMediaService';

describe('memeMediaService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequestPermissionsAsync.mockResolvedValue({ granted: true });
    mockSharingAvailableAsync.mockResolvedValue(true);
    mockWriteAsStringAsync.mockResolvedValue(undefined);
    mockSaveToLibraryAsync.mockResolvedValue(undefined);
    mockShareAsync.mockResolvedValue(undefined);
  });

  it('returns permission_denied when media-library permission is refused', async () => {
    mockRequestPermissionsAsync.mockResolvedValueOnce({ granted: false });

    const result = await saveMemeImage({
      imageUri: 'data:image/png;base64,YWJj'
    });

    expect(result).toEqual({
      ok: false,
      code: 'permission_denied'
    });
    expect(mockSaveToLibraryAsync).not.toHaveBeenCalled();
  });

  it('saves a data-uri meme locally on native platforms', async () => {
    const result = await saveMemeImage({
      imageUri: 'data:image/png;base64,YWJj'
    });

    expect(result).toEqual({ ok: true });
    expect(mockWriteAsStringAsync).toHaveBeenCalledTimes(1);
    expect(mockSaveToLibraryAsync).toHaveBeenCalledTimes(1);
  });

  it('returns share_unavailable when native share sheet is unavailable', async () => {
    mockSharingAvailableAsync.mockResolvedValueOnce(false);

    const result = await shareMemeImage({
      imageUri: 'data:image/png;base64,YWJj'
    });

    expect(result).toEqual({
      ok: false,
      code: 'share_unavailable'
    });
    expect(mockShareAsync).not.toHaveBeenCalled();
  });

  it('shares a data-uri meme through native share sheet when available', async () => {
    const result = await shareMemeImage({
      imageUri: 'data:image/png;base64,YWJj'
    });

    expect(result).toEqual({ ok: true });
    expect(mockWriteAsStringAsync).toHaveBeenCalledTimes(1);
    expect(mockShareAsync).toHaveBeenCalledTimes(1);
  });
});
