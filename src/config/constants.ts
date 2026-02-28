export const APP_DEFAULT_LANGUAGE = 'fr-CA';
export const MOCK_STREAM_TOKEN_DELAY_MS = 42;
export const MAX_HISTORY_MESSAGES = 20;
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_IMAGE_UPLOAD_BYTES = 3_000_000;

export const ARTIST_IDS = {
  CATHY_GAUTHIER: 'cathy-gauthier'
} as const;

export const MODE_IDS = {
  DEFAULT: 'default',
  RADAR_ATTITUDE: 'radar-attitude',
  ROAST: 'roast',
  COACH_DE_VIE: 'coach-de-vie',
  PHRASE_DU_JOUR: 'phrase-du-jour',
  MESSAGE_PERSONNALISE: 'message-personnalise',
  NUMERO_DE_SHOW: 'numero-de-show',
  HOROSCOPE: 'horoscope',
  METEO: 'meteo',
  HISTORY: 'history'
} as const;
