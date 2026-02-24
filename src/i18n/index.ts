import { en } from './en';
import { fr } from './fr';

const dictionaries = {
  'fr-CA': fr,
  'fr-FR': fr,
  'en-CA': en,
  en
};

export type DictionaryKey = keyof typeof fr;

let currentLanguage: keyof typeof dictionaries = 'fr-CA';

export function setLanguage(language: string): void {
  currentLanguage = language in dictionaries ? (language as keyof typeof dictionaries) : 'fr-CA';
}

export function t(key: DictionaryKey): string {
  return dictionaries[currentLanguage][key] ?? fr[key];
}
