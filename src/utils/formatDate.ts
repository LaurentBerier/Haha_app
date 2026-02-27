import { getLanguage } from '../i18n';

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleTimeString(getLanguage());
}
