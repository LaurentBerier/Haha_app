describe('memeMediaService web share fallback', () => {
  const mockSharingAvailableAsync = jest.fn<Promise<boolean>, []>(async () => true);
  const mockShareAsync = jest.fn<Promise<void>, unknown[]>(async () => undefined);
  const mockNavigatorShare = jest.fn<Promise<void>, [unknown]>(async () => undefined);
  const mockNavigatorCanShare = jest.fn<boolean, [unknown]>(() => true);

  beforeEach(() => {
    jest.resetModules();
    mockSharingAvailableAsync.mockReset();
    mockShareAsync.mockReset();
    mockNavigatorShare.mockReset();
    mockNavigatorCanShare.mockReset();
    mockSharingAvailableAsync.mockResolvedValue(true);
    mockShareAsync.mockResolvedValue(undefined);
    mockNavigatorShare.mockResolvedValue(undefined);
    mockNavigatorCanShare.mockReturnValue(true);
    Object.defineProperty(globalThis, 'navigator', {
      value: undefined,
      writable: true,
      configurable: true
    });
    delete (globalThis as unknown as { File?: unknown }).File;
    delete (globalThis as unknown as { atob?: unknown }).atob;
  });

  it('uses Web Share API with image file when available', async () => {
    class MockFile {
      name: string;
      type: string;

      constructor(_parts: unknown[], name: string, options?: { type?: string }) {
        this.name = name;
        this.type = options?.type ?? '';
      }
    }

    (globalThis as unknown as { File?: unknown }).File = MockFile;
    (globalThis as unknown as { atob?: unknown }).atob = (value: string) =>
      Buffer.from(value, 'base64').toString('binary');
    (globalThis as unknown as { window?: unknown }).window = {
      location: {
        href: ''
      }
    };
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        share: (...args: [unknown]) => mockNavigatorShare(...args),
        canShare: (...args: [unknown]) => mockNavigatorCanShare(...args)
      },
      writable: true,
      configurable: true
    });

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
    expect(mockNavigatorShare).toHaveBeenCalledTimes(1);
    const payload = mockNavigatorShare.mock.calls[0]?.[0] as { files?: Array<{ type?: string }> } | undefined;
    expect(Array.isArray(payload?.files)).toBe(true);
    expect(payload?.files?.[0]?.type).toBe('image/png');
    expect(mockShareAsync).not.toHaveBeenCalled();
  });

  it('falls back to expo-sharing when Web Share API is unavailable', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      writable: true,
      configurable: true
    });
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

    const { shareMemeImage } = await import('./memeMediaService');
    const result = await shareMemeImage({
      imageUri: 'data:image/png;base64,YWJj',
      dialogTitle: 'Meme'
    });

    expect(result).toEqual({ ok: true });
    expect(mockShareAsync).toHaveBeenCalledTimes(1);
  });

  it('returns share_cancelled when user cancels Web Share dialog', async () => {
    class MockFile {
      name: string;
      type: string;

      constructor(_parts: unknown[], name: string, options?: { type?: string }) {
        this.name = name;
        this.type = options?.type ?? '';
      }
    }

    (globalThis as unknown as { File?: unknown }).File = MockFile;
    (globalThis as unknown as { atob?: unknown }).atob = (value: string) =>
      Buffer.from(value, 'base64').toString('binary');
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        share: (...args: [unknown]) => mockNavigatorShare(...args),
        canShare: (...args: [unknown]) => mockNavigatorCanShare(...args)
      },
      writable: true,
      configurable: true
    });
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

    mockNavigatorShare.mockRejectedValueOnce({
      name: 'AbortError'
    });

    const { shareMemeImage } = await import('./memeMediaService');
    const result = await shareMemeImage({
      imageUri: 'data:image/png;base64,YWJj',
      dialogTitle: 'Meme'
    });

    expect(result).toEqual({
      ok: false,
      code: 'share_cancelled'
    });
    expect(mockShareAsync).not.toHaveBeenCalled();
  });

  it('falls back to mailto when document is unavailable', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      writable: true,
      configurable: true
    });
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
