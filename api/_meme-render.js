const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

const ALLOWED_IMAGE_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_IMAGE_BYTES = 3_000_000;
const MAX_CAPTION_CHARS = 120;
const DEFAULT_PLACEMENT = 'top';
const MAX_RENDER_WIDTH = 1_080;
const CAPTION_FONT_FAMILY = 'Anton Meme';
const CAPTION_FONT_PATH = path.join(process.cwd(), 'assets', 'fonts', 'Anton-Regular.ttf');
const CAPTION_FONT_FALLBACK = 'sans-serif';

const LOGO_PATH = path.join(process.cwd(), 'assets', 'branding', 'logo-neon-Trans.png');

let logoBufferCache = null;
let logoLoadFailure = null;
let captionFontLoadState = 'idle';
let captionFontLoadWarningShown = false;

function ensureCaptionFontLoaded() {
  if (captionFontLoadState === 'loaded' || captionFontLoadState === 'failed') {
    return;
  }

  try {
    const registered = GlobalFonts.registerFromPath(CAPTION_FONT_PATH, CAPTION_FONT_FAMILY);
    if (!registered) {
      throw new Error('GlobalFonts.registerFromPath returned null.');
    }
    captionFontLoadState = 'loaded';
  } catch (error) {
    captionFontLoadState = 'failed';
    if (!captionFontLoadWarningShown) {
      captionFontLoadWarningShown = true;
      console.warn('[api/_meme-render] Caption font registration failed. Falling back to sans-serif.', error);
    }
  }
}

function resolveCaptionFont(sizePx) {
  const normalizedSize = Math.max(1, Math.round(Number(sizePx) || 1));
  if (captionFontLoadState === 'loaded') {
    return `700 ${normalizedSize}px "${CAPTION_FONT_FAMILY}", ${CAPTION_FONT_FALLBACK}`;
  }
  return `700 ${normalizedSize}px ${CAPTION_FONT_FALLBACK}`;
}

function getApproxBase64Bytes(base64Data) {
  const data = String(base64Data ?? '').replace(/\s+/g, '');
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

function normalizePlacement(value) {
  return value === 'bottom' ? 'bottom' : DEFAULT_PLACEMENT;
}

function normalizeCaption(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) {
    return '';
  }

  return compact.slice(0, MAX_CAPTION_CHARS);
}

function normalizeImageInput(rawImage) {
  if (!rawImage || typeof rawImage !== 'object') {
    throw new Error('Image payload is required.');
  }

  const mediaType = typeof rawImage.mediaType === 'string' ? rawImage.mediaType.trim().toLowerCase() : '';
  if (!ALLOWED_IMAGE_MEDIA_TYPES.has(mediaType)) {
    throw new Error('Unsupported image media type.');
  }

  const base64 = typeof rawImage.base64 === 'string' ? rawImage.base64.trim() : '';
  if (!base64) {
    throw new Error('Image base64 is required.');
  }

  const bytes = getApproxBase64Bytes(base64);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    throw new Error('Invalid image payload.');
  }

  if (bytes > MAX_IMAGE_BYTES) {
    throw new Error(`Image too large. Max is ${MAX_IMAGE_BYTES} bytes.`);
  }

  return {
    mediaType,
    base64,
    bytes
  };
}

function decodeImageBuffer(image) {
  return Buffer.from(image.base64, 'base64');
}

function loadLogoBuffer() {
  if (logoBufferCache) {
    return logoBufferCache;
  }

  if (logoLoadFailure) {
    throw logoLoadFailure;
  }

  try {
    logoBufferCache = fs.readFileSync(LOGO_PATH);
    return logoBufferCache;
  } catch (error) {
    const failure = new Error('Meme logo file is missing or unreadable.');
    failure.cause = error;
    logoLoadFailure = failure;
    throw failure;
  }
}

function createMeasureContext() {
  const canvas = createCanvas(16, 16);
  return canvas.getContext('2d');
}

function wrapCaptionLines(ctx, text, maxWidth, maxLines) {
  const safeText = normalizeCaption(text);
  if (!safeText) {
    return [''];
  }

  const words = safeText.split(' ').filter(Boolean);
  if (words.length === 0) {
    return [''];
  }

  const lines = [];
  let currentLine = words[0];

  for (let index = 1; index < words.length; index += 1) {
    const candidate = `${currentLine} ${words[index]}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      currentLine = candidate;
      continue;
    }

    lines.push(currentLine);
    currentLine = words[index];

    if (lines.length >= maxLines) {
      break;
    }
  }

  if (lines.length < maxLines && currentLine) {
    lines.push(currentLine);
  }

  if (lines.length <= maxLines) {
    return lines;
  }

  return lines.slice(0, maxLines);
}

function ellipsizeLineToWidth(ctx, line, maxWidth) {
  const safeLine = String(line ?? '').trim();
  if (!safeLine) {
    return '';
  }

  if (ctx.measureText(safeLine).width <= maxWidth) {
    return safeLine;
  }

  let current = safeLine;
  while (current.length > 1 && ctx.measureText(`${current}...`).width > maxWidth) {
    current = current.slice(0, -1);
  }

  return `${current}...`;
}

function layoutCaption({ caption, imageWidth }) {
  ensureCaptionFontLoaded();
  const measureCtx = createMeasureContext();
  const maxLines = 3;
  const horizontalPadding = Math.max(24, Math.round(imageWidth * 0.06));
  const maxTextWidth = Math.max(120, imageWidth - horizontalPadding * 2);
  const maxFont = Math.min(72, Math.max(26, Math.round(imageWidth * 0.095)));
  const minFont = Math.max(18, Math.round(imageWidth * 0.05));

  let winning = null;

  for (let fontSize = maxFont; fontSize >= minFont; fontSize -= 2) {
    measureCtx.font = resolveCaptionFont(fontSize);
    const wrapped = wrapCaptionLines(measureCtx, caption, maxTextWidth, maxLines);
    if (wrapped.length > maxLines) {
      continue;
    }

    const lastIndex = wrapped.length - 1;
    const normalized = wrapped.map((line, index) =>
      index === lastIndex ? ellipsizeLineToWidth(measureCtx, line, maxTextWidth) : line
    );

    const hasOverflow = normalized.some((line) => measureCtx.measureText(line).width > maxTextWidth + 0.5);
    if (hasOverflow) {
      continue;
    }

    winning = {
      fontSize,
      lines: normalized,
      maxTextWidth,
      horizontalPadding
    };
    break;
  }

  if (winning) {
    return winning;
  }

  measureCtx.font = resolveCaptionFont(minFont);
  const collapsed = ellipsizeLineToWidth(measureCtx, normalizeCaption(caption), maxTextWidth);
  return {
    fontSize: minFont,
    lines: [collapsed],
    maxTextWidth,
    horizontalPadding
  };
}

function computeBandHeight(layout, imageWidth, includeCaption) {
  const baseMin = Math.max(64, Math.round(imageWidth * 0.11));
  if (!includeCaption) {
    return baseMin;
  }

  const lineHeight = Math.ceil(layout.fontSize * 1.2);
  const verticalPadding = Math.max(18, Math.round(layout.fontSize * 0.45));
  const textHeight = layout.lines.length * lineHeight;
  return Math.max(baseMin, textHeight + verticalPadding * 2);
}

function resolveLogoSize({ imageWidth, bottomBandHeight, logoImage }) {
  const safePadding = Math.max(14, Math.round(imageWidth * 0.03));
  const maxLogoWidth = Math.max(74, Math.round(imageWidth * 0.21));
  const maxLogoHeight = Math.max(28, bottomBandHeight - safePadding * 2);
  const scale = Math.min(maxLogoWidth / logoImage.width, maxLogoHeight / logoImage.height);

  return {
    width: Math.max(44, Math.round(logoImage.width * scale)),
    height: Math.max(18, Math.round(logoImage.height * scale)),
    safePadding
  };
}

function drawCaptionInBand({ ctx, layout, yStart, bandHeight, imageWidth }) {
  ensureCaptionFontLoaded();
  const lineHeight = Math.ceil(layout.fontSize * 1.2);
  const totalTextHeight = layout.lines.length * lineHeight;
  const textTop = Math.round(yStart + (bandHeight - totalTextHeight) / 2 + lineHeight * 0.82);

  ctx.font = resolveCaptionFont(layout.fontSize);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  let maxLineWidth = 0;
  layout.lines.forEach((line, index) => {
    const y = textTop + index * lineHeight;
    const width = ctx.measureText(line).width;
    if (width > maxLineWidth) {
      maxLineWidth = width;
    }
    ctx.fillText(line, Math.round(imageWidth / 2), y);
  });

  const centerX = imageWidth / 2;
  const halfWidth = maxLineWidth / 2;

  return {
    minX: Math.max(0, centerX - halfWidth),
    maxX: Math.min(imageWidth, centerX + halfWidth)
  };
}

function resolveAutoLogoPlacement({ imageWidth, safePadding, logoWidth, captionBounds }) {
  if (!captionBounds) {
    return 'right';
  }

  const leftSpace = captionBounds.minX - safePadding;
  const rightSpace = imageWidth - captionBounds.maxX - safePadding;

  if (rightSpace >= logoWidth + safePadding) {
    return 'right';
  }

  if (leftSpace >= logoWidth + safePadding) {
    return 'left';
  }

  return rightSpace >= leftSpace ? 'right' : 'left';
}

async function renderMemeImage({ image, caption, placement = DEFAULT_PLACEMENT }) {
  const normalizedCaption = normalizeCaption(caption);
  if (!normalizedCaption) {
    throw new Error('Caption is required.');
  }

  const sourceBuffer = decodeImageBuffer(image);
  const [sourceImage, logoImage] = await Promise.all([
    loadImage(sourceBuffer),
    loadImage(loadLogoBuffer())
  ]);

  const sourceWidth = sourceImage.width;
  const sourceHeight = sourceImage.height;
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('Could not decode source image.');
  }

  const scale = sourceWidth > MAX_RENDER_WIDTH ? MAX_RENDER_WIDTH / sourceWidth : 1;
  const imageWidth = Math.max(1, Math.round(sourceWidth * scale));
  const imageHeight = Math.max(1, Math.round(sourceHeight * scale));

  const resolvedPlacement = normalizePlacement(placement);
  const layout = layoutCaption({ caption: normalizedCaption, imageWidth });

  let topBandHeight = computeBandHeight(layout, imageWidth, resolvedPlacement === 'top');
  let bottomBandHeight = computeBandHeight(layout, imageWidth, resolvedPlacement === 'bottom');

  let logoSize = resolveLogoSize({ imageWidth, bottomBandHeight, logoImage });
  if (logoSize.height + logoSize.safePadding * 2 > bottomBandHeight) {
    bottomBandHeight = logoSize.height + logoSize.safePadding * 2;
    logoSize = resolveLogoSize({ imageWidth, bottomBandHeight, logoImage });
  }

  const outputHeight = topBandHeight + imageHeight + bottomBandHeight;
  const canvas = createCanvas(imageWidth, outputHeight);
  const ctx = canvas.getContext('2d');

  // Solid meme framing bands and background.
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, imageWidth, outputHeight);
  ctx.drawImage(sourceImage, 0, topBandHeight, imageWidth, imageHeight);

  let bottomCaptionBounds = null;
  if (resolvedPlacement === 'top') {
    drawCaptionInBand({
      ctx,
      layout,
      yStart: 0,
      bandHeight: topBandHeight,
      imageWidth
    });
  } else {
    bottomCaptionBounds = drawCaptionInBand({
      ctx,
      layout,
      yStart: topBandHeight + imageHeight,
      bandHeight: bottomBandHeight,
      imageWidth
    });
  }

  const logoPlacement = resolveAutoLogoPlacement({
    imageWidth,
    safePadding: logoSize.safePadding,
    logoWidth: logoSize.width,
    captionBounds: resolvedPlacement === 'bottom' ? bottomCaptionBounds : null
  });

  const logoX =
    logoPlacement === 'left'
      ? logoSize.safePadding
      : imageWidth - logoSize.width - logoSize.safePadding;
  const logoY = topBandHeight + imageHeight + Math.round((bottomBandHeight - logoSize.height) / 2);

  ctx.globalAlpha = 0.9;
  ctx.drawImage(logoImage, logoX, logoY, logoSize.width, logoSize.height);
  ctx.globalAlpha = 1;

  return {
    mimeType: 'image/png',
    base64: canvas.toBuffer('image/png').toString('base64'),
    logoPlacement
  };
}

module.exports = {
  ALLOWED_IMAGE_MEDIA_TYPES,
  MAX_IMAGE_BYTES,
  normalizeImageInput,
  normalizeCaption,
  normalizePlacement,
  renderMemeImage
};
