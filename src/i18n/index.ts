import { APP_DEFAULT_LANGUAGE } from '../config/constants';
import { en } from './en';
import { fr } from './fr';

const dictionaries = {
  'fr-CA': fr,
  'fr-FR': fr,
  'en-CA': en,
  en
};

export type DictionaryKey = keyof typeof fr;
type SupportedLanguage = keyof typeof dictionaries;

function resolveLanguage(language: string | undefined): SupportedLanguage {
  if (!language) {
    return 'fr-CA';
  }

  if (language in dictionaries) {
    return language as SupportedLanguage;
  }

  const normalized = language.toLowerCase();
  if (normalized.startsWith('fr')) {
    return 'fr-CA';
  }
  if (normalized.startsWith('en')) {
    return 'en-CA';
  }

  return 'fr-CA';
}

let currentLanguage: SupportedLanguage = resolveLanguage(APP_DEFAULT_LANGUAGE);

export function setLanguage(language: string): void {
  currentLanguage = resolveLanguage(language);
}

export function getLanguage(): SupportedLanguage {
  return currentLanguage;
}

export function t(key: DictionaryKey): string {
  return dictionaries[currentLanguage][key] ?? fr[key];
}
