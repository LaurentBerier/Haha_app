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
    const registerFromPath = jest.fn(() => {
      throw new Error('font registration failed');
    });

    jest.doMock('@napi-rs/canvas', () => ({
      ...actualCanvas,
      GlobalFonts: {
        registerFromPath
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
    expect(registerFromPath).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
