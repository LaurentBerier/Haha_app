function createSourceBase64(width = 720, height = 480) {
  const { createCanvas } = jest.requireActual('@napi-rs/canvas');
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#6d7f92';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#7f91a4';
  ctx.fillRect(0, Math.floor(height * 0.2), width, Math.floor(height * 0.4));
  return canvas.toBuffer('image/png').toString('base64');
}

function createInputImage(memeRender) {
  return memeRender.normalizeImageInput({
    mediaType: 'image/png',
    base64: createSourceBase64()
  });
}

async function analyzeRenderedBands(base64Png) {
  const { createCanvas, loadImage } = jest.requireActual('@napi-rs/canvas');
  const decoded = Buffer.from(base64Png, 'base64');
  const image = await loadImage(decoded);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, image.width, image.height);
  const data = ctx.getImageData(0, 0, image.width, image.height).data;

  const rows = [];
  for (let y = 0; y < image.height; y += 1) {
    let nonBlackPixels = 0;
    let brightPixels = 0;
    let blackPixels = 0;
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      if (r + g + b > 30) {
        nonBlackPixels += 1;
      }
      if (r > 205 && g > 205 && b > 205) {
        brightPixels += 1;
      }
      if (r < 20 && g < 20 && b < 20) {
        blackPixels += 1;
      }
    }
    rows.push({
      y,
      nonBlackPixels,
      brightPixels,
      blackPixels,
      pixelCount: image.width
    });
  }

  const imageRowThreshold = Math.floor(image.width * 0.9);
  const topBandHeight = rows.find((row) => row.nonBlackPixels > imageRowThreshold)?.y ?? 0;
  let lastImageRow = -1;
  rows.forEach((row) => {
    if (row.nonBlackPixels > imageRowThreshold) {
      lastImageRow = row.y;
    }
  });
  const bottomBandStart = lastImageRow + 1;

  const sumBand = (start, end) =>
    rows.slice(start, end).reduce(
      (acc, row) => ({
        brightPixels: acc.brightPixels + row.brightPixels,
        blackPixels: acc.blackPixels + row.blackPixels,
        totalPixels: acc.totalPixels + row.pixelCount
      }),
      { brightPixels: 0, blackPixels: 0, totalPixels: 0 }
    );

  return {
    width: image.width,
    height: image.height,
    topBand: {
      height: topBandHeight,
      ...sumBand(0, topBandHeight)
    },
    bottomBand: {
      height: image.height - bottomBandStart,
      ...sumBand(bottomBandStart, image.height)
    }
  };
}

async function analyzeBottomLogoExclusion(base64Png, referenceLogoSize = null) {
  const { createCanvas, loadImage } = jest.requireActual('@napi-rs/canvas');
  const decoded = Buffer.from(base64Png, 'base64');
  const image = await loadImage(decoded);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, image.width, image.height);
  const data = ctx.getImageData(0, 0, image.width, image.height).data;

  const rowStats = [];
  for (let y = 0; y < image.height; y += 1) {
    let nonBlackPixels = 0;
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      if (r + g + b > 30) {
        nonBlackPixels += 1;
      }
    }
    rowStats.push(nonBlackPixels);
  }

  const imageRowThreshold = Math.floor(image.width * 0.9);
  let lastImageRow = -1;
  rowStats.forEach((nonBlackPixels, rowIndex) => {
    if (nonBlackPixels > imageRowThreshold) {
      lastImageRow = rowIndex;
    }
  });
  const bottomBandStart = lastImageRow + 1;

  let logoWidth =
    referenceLogoSize && typeof referenceLogoSize.width === 'number'
      ? Math.round(referenceLogoSize.width)
      : 0;
  let logoHeight =
    referenceLogoSize && typeof referenceLogoSize.height === 'number'
      ? Math.round(referenceLogoSize.height)
      : 0;

  if (logoWidth <= 0 || logoHeight <= 0) {
    const rightRegionStartX = Math.floor(image.width * 0.6);
    let detectedMinX = image.width;
    let detectedMinY = image.height;
    let detectedMaxX = -1;
    let detectedMaxY = -1;
    for (let y = bottomBandStart; y < image.height; y += 1) {
      for (let x = rightRegionStartX; x < image.width; x += 1) {
        const offset = (y * image.width + x) * 4;
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        const isBrightWhite = r > 205 && g > 205 && b > 205;
        const isLogoLikePixel = r + g + b > 70 && !isBrightWhite;
        if (!isLogoLikePixel) {
          continue;
        }
        if (x < detectedMinX) {
          detectedMinX = x;
        }
        if (y < detectedMinY) {
          detectedMinY = y;
        }
        if (x > detectedMaxX) {
          detectedMaxX = x;
        }
        if (y > detectedMaxY) {
          detectedMaxY = y;
        }
      }
    }
    if (detectedMaxX < detectedMinX || detectedMaxY < detectedMinY) {
      return {
        brightInsideLogoRect: 0,
        brightOutsideLogoRect: 0,
        logoWidth: 0,
        logoHeight: 0
      };
    }
    logoWidth = detectedMaxX - detectedMinX + 1;
    logoHeight = detectedMaxY - detectedMinY + 1;
  }

  const LOGO_SAFE_PADDING_FOR_TEST = 12;
  const bottomBandHeight = image.height - bottomBandStart;
  const logoMinX = image.width - logoWidth - LOGO_SAFE_PADDING_FOR_TEST;
  const logoMaxX = logoMinX + logoWidth - 1;
  const logoMinY = bottomBandStart + Math.round((bottomBandHeight - logoHeight) / 2);
  const logoMaxY = logoMinY + logoHeight - 1;
  const outsideScanStartX = Math.max(0, logoMinX - 10);
  let brightInsideLogoRect = 0;
  let brightOutsideLogoRect = 0;

  for (let y = bottomBandStart; y < image.height; y += 1) {
    for (let x = outsideScanStartX; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const isBright = r > 205 && g > 205 && b > 205;
      if (!isBright) {
        continue;
      }
      const inLogoRect = x >= logoMinX && x <= logoMaxX && y >= logoMinY && y <= logoMaxY;
      if (inLogoRect) {
        brightInsideLogoRect += 1;
      } else {
        brightOutsideLogoRect += 1;
      }
    }
  }

  return {
    brightInsideLogoRect,
    brightOutsideLogoRect,
    logoWidth,
    logoHeight
  };
}

describe('api/_meme-render', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.dontMock('@napi-rs/canvas');
    jest.restoreAllMocks();
  });

  it('renders visible white caption in top black band for top placement', async () => {
    const memeRender = require('../_meme-render');
    const rendered = await memeRender.renderMemeImage({
      image: createInputImage(memeRender),
      caption: 'Quand tu ouvres 37 onglets pour une seule tache',
      placement: 'top'
    });

    const analysis = await analyzeRenderedBands(rendered.base64);
    expect(analysis.topBand.height).toBeGreaterThan(0);
    expect(analysis.bottomBand.height).toBeGreaterThan(0);
    expect(analysis.topBand.brightPixels).toBeGreaterThan(300);
    expect(analysis.topBand.brightPixels).toBeGreaterThan(analysis.bottomBand.brightPixels);
    expect(analysis.topBand.blackPixels).toBeGreaterThan(analysis.topBand.totalPixels * 0.5);
    expect(analysis.bottomBand.blackPixels).toBeGreaterThan(analysis.bottomBand.totalPixels * 0.5);
  });

  it('renders visible white caption in bottom black band for bottom placement', async () => {
    const memeRender = require('../_meme-render');
    const rendered = await memeRender.renderMemeImage({
      image: createInputImage(memeRender),
      caption: 'Quand tu ouvres 37 onglets pour une seule tache',
      placement: 'bottom'
    });

    const analysis = await analyzeRenderedBands(rendered.base64);
    expect(analysis.topBand.height).toBeGreaterThan(0);
    expect(analysis.bottomBand.height).toBeGreaterThan(0);
    expect(analysis.bottomBand.brightPixels).toBeGreaterThan(300);
    expect(analysis.bottomBand.brightPixels).toBeGreaterThan(analysis.topBand.brightPixels);
    expect(analysis.topBand.blackPixels).toBeGreaterThan(analysis.topBand.totalPixels * 0.5);
    expect(analysis.bottomBand.blackPixels).toBeGreaterThan(analysis.bottomBand.totalPixels * 0.5);
  });

  it('falls back to sans-serif and does not crash when font registration fails', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const actualCanvas = jest.requireActual('@napi-rs/canvas');
    const register = jest.fn(() => {
      throw new Error('font registration failed');
    });

    jest.doMock('@napi-rs/canvas', () => ({
      ...actualCanvas,
      GlobalFonts: {
        register
      }
    }));

    const memeRender = require('../_meme-render');
    await expect(
      memeRender.renderMemeImage({
        image: createInputImage(memeRender),
        caption: 'Caption de fallback',
        placement: 'top'
      })
    ).resolves.toEqual(
      expect.objectContaining({
        mimeType: 'image/png',
        base64: expect.any(String)
      })
    );
    expect(register).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps bottom caption out of the logo exclusion lane', async () => {
    const memeRender = require('../_meme-render');
    const topRendered = await memeRender.renderMemeImage({
      image: createInputImage(memeRender),
      caption: 'Moi attendant que quelqu un commande pour enfin manger',
      placement: 'top'
    });
    const bottomRendered = await memeRender.renderMemeImage({
      image: createInputImage(memeRender),
      caption: 'Moi attendant que quelqu un commande pour enfin manger',
      placement: 'bottom'
    });

    const topAnalysis = await analyzeBottomLogoExclusion(topRendered.base64);
    const bottomAnalysis = await analyzeBottomLogoExclusion(bottomRendered.base64, {
      width: topAnalysis.logoWidth,
      height: topAnalysis.logoHeight
    });
    expect(bottomAnalysis.brightInsideLogoRect).toBeGreaterThan(100);
    expect(bottomAnalysis.brightOutsideLogoRect).toBeLessThanOrEqual(topAnalysis.brightOutsideLogoRect + 40);
  });

  it('keeps logo small and stable across captions', async () => {
    const memeRender = require('../_meme-render');
    const shortTop = await memeRender.renderMemeImage({
      image: createInputImage(memeRender),
      caption: 'Caption court',
      placement: 'top'
    });
    const longTop = await memeRender.renderMemeImage({
      image: createInputImage(memeRender),
      caption: 'Caption super long pour pousser le wrapping au maximum dans la bande du haut',
      placement: 'top'
    });

    const shortAnalysis = await analyzeBottomLogoExclusion(shortTop.base64);
    const longAnalysis = await analyzeBottomLogoExclusion(longTop.base64);

    expect(shortAnalysis.logoWidth).toBeGreaterThan(0);
    expect(shortAnalysis.logoHeight).toBeGreaterThan(0);
    expect(shortAnalysis.logoWidth).toBeLessThanOrEqual(90);
    expect(shortAnalysis.logoHeight).toBeLessThanOrEqual(45);
    expect(Math.abs(shortAnalysis.logoWidth - longAnalysis.logoWidth)).toBeLessThanOrEqual(2);
    expect(Math.abs(shortAnalysis.logoHeight - longAnalysis.logoHeight)).toBeLessThanOrEqual(2);
  });
});
