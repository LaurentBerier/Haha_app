import { MODE_IDS } from '../config/constants';
import type { Mode } from '../models/Mode';

const MODE_EMOJI_BY_ID: Record<string, string> = {
  [MODE_IDS.ON_JASE]: '🎤',
  [MODE_IDS.GRILL]: '🔥',
  [MODE_IDS.COACH_DE_VIE]: '🧭',
  [MODE_IDS.MESSAGE_PERSONNALISE]: '🎁',
  [MODE_IDS.NUMERO_DE_SHOW]: '🎤',
  [MODE_IDS.HOROSCOPE]: '🔮',
  [MODE_IDS.METEO]: '⛅',
  [MODE_IDS.MEME_GENERATOR]: '😂',
  [MODE_IDS.SCREENSHOT_ANALYZER]: '🔍',
  [MODE_IDS.ROAST_BATTLE]: '⚔️'
};

const MODE_EMOJI_FALLBACK_POOL = ['🎭', '🎯', '⚡', '🧨', '🗣️', '🧠', '🎬', '🤹', '🧩', '🎪'];

function hashModeId(modeId: string): number {
  let hash = 0;
  for (const char of modeId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

export function getModeEmoji(mode: Pick<Mode, 'id' | 'emoji'> | null | undefined): string {
  if (!mode) {
    return '🎭';
  }

  if (mode.emoji) {
    return mode.emoji;
  }

  const mapped = MODE_EMOJI_BY_ID[mode.id];
  if (mapped) {
    return mapped;
  }

  const index = hashModeId(mode.id) % MODE_EMOJI_FALLBACK_POOL.length;
  return MODE_EMOJI_FALLBACK_POOL[index] ?? '🎭';
}
