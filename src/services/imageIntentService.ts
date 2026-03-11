import { MODE_IDS } from '../config/constants';

export type ImageIntent = 'photo-roast' | 'meme-generator' | 'screenshot-analyzer' | 'default';

export function detectImageIntent(modeId: string, hasText: boolean): ImageIntent {
  if (!modeId) {
    return 'default';
  }

  if (modeId === MODE_IDS.ROAST) {
    return 'photo-roast';
  }

  if (modeId === MODE_IDS.MEME_GENERATOR) {
    return 'meme-generator';
  }

  if (modeId === MODE_IDS.SCREENSHOT_ANALYZER) {
    return 'screenshot-analyzer';
  }

  if (!hasText) {
    return 'default';
  }

  return 'default';
}
