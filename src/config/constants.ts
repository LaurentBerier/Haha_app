export const APP_DEFAULT_LANGUAGE = 'fr-CA';
export const MOCK_STREAM_TOKEN_DELAY_MS = 42;
export const MAX_HISTORY_MESSAGES = 20;
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_IMAGE_UPLOAD_BYTES = 3_000_000;
export const MAX_IMAGE_SOURCE_BYTES = 10_000_000;
export const AUTH_CALLBACK_SCHEME_URL = 'hahaha://auth/callback';

export const ARTIST_IDS = {
  CATHY_GAUTHIER: 'cathy-gauthier',
  MYSTERY_ARTIST_ONE: 'mystery-artist-one',
  MYSTERY_ARTIST_TWO: 'mystery-artist-two'
} as const;

export const MODE_IDS = {
  DEFAULT: 'default',
  ON_JASE: 'on-jase',
  GRILL: 'grill',
  RADAR_ATTITUDE: 'radar-attitude',
  RELAX: 'relax',
  ROAST: 'roast',
  COACH_BRUTAL: 'coach-brutal',
  JE_CASSE_TOUT: 'je-casse-tout',
  COACH_DE_VIE: 'coach-de-vie',
  MESSAGE_PERSONNALISE: 'message-personnalise',
  NUMERO_DE_SHOW: 'numero-de-show',
  HOROSCOPE: 'horoscope',
  METEO: 'meteo',
  MEME_GENERATOR: 'meme-generator',
  SCREENSHOT_ANALYZER: 'screenshot-analyzer',
  ROAST_BATTLE: 'roast-battle',
  HISTORY: 'history'
} as const;
