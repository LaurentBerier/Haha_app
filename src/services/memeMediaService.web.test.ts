describe('memeMediaService web share fallback', () => {
  const mockSharingAvailableAsync = jest.fn<Promise<boolean>, []>(async () => true);
  const mockShareAsync = jest.fn<Promise<void>, unknown[]>(async () => undefined);

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockSharingAvailableAsync.mockResolvedValue(true);
    mockShareAsync.mockResolvedValue(undefined);
  });

  it('falls back to browser download when web share throws', async () => {
    const anchor = {
      href: '',
      download: '',
      rel: '',
      click: jest.fn()
    };
    const appendChild = jest.fn();
    const removeChild = jest.fn();

    (globalThis as unknown as { document?: unknown }).document = {
      createElement: jest.fn(() => anchor),
      body: {
        appendChild,
        removeChild
      }
    };
    (globalThis as unknown as { window?: unknown }).window = {
      location: {
        href: ''
      }
    };

    jest.doMock('react-native', () => ({
      Platform: {
        OS: 'web'
      }
    }));

    jest.doMock('expo-sharing', () => ({
      isAvailableAsync: () => mockSharingAvailableAsync(),
      shareAsync: (...args: unknown[]) => mockShareAsync(...args)
    }));

    jest.doMock('expo-file-system', () => ({
      cacheDirectory: 'file:///cache/',
      writeAsStringAsync: jest.fn(),
      downloadAsync: jest.fn(),
      EncodingType: {
        Base64: 'base64'
      }
    }));

    jest.doMock('expo-media-library', () => ({
      requestPermissionsAsync: jest.fn(),
      saveToLibraryAsync: jest.fn()
    }));

    mockShareAsync.mockRejectedValueOnce(new Error('share failed'));

    const { shareMemeImage } = await import('./memeMediaService');
    const result = await shareMemeImage({
      imageUri: 'data:image/png;base64,YWJj',
      dialogTitle: 'Meme'
    });

    expect(result).toEqual({ ok: true });
    expect(mockShareAsync).toHaveBeenCalledTimes(1);
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(appendChild).toHaveBeenCalledTimes(1);
    expect(removeChild).toHaveBeenCalledTimes(1);
  });

  it('falls back to mailto when document is unavailable', async () => {
    const location = { href: '' };
    (globalThis as unknown as { window?: unknown }).window = { location };
    delete (globalThis as unknown as { document?: unknown }).document;

    jest.doMock('react-native', () => ({
      Platform: {
        OS: 'web'
      }
    }));

    jest.doMock('expo-sharing', () => ({
      isAvailableAsync: () => mockSharingAvailableAsync(),
      shareAsync: (...args: unknown[]) => mockShareAsync(...args)
    }));

    jest.doMock('expo-file-system', () => ({
      cacheDirectory: 'file:///cache/',
      writeAsStringAsync: jest.fn(),
      downloadAsync: jest.fn(),
      EncodingType: {
        Base64: 'base64'
      }
    }));

    jest.doMock('expo-media-library', () => ({
      requestPermissionsAsync: jest.fn(),
      saveToLibraryAsync: jest.fn()
    }));

    mockSharingAvailableAsync.mockResolvedValueOnce(false);

    const { shareMemeImage } = await import('./memeMediaService');
    const result = await shareMemeImage({
      imageUri: 'data:image/png;base64,YWJj',
      dialogTitle: 'Meme'
    });

    expect(result).toEqual({ ok: true });
    expect(location.href).toContain('mailto:');
  });
});
