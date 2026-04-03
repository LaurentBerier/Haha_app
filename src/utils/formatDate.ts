import { getLanguage } from '../i18n';

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleTimeString(getLanguage());
}

export function formatShortDate(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) {
    return '';
  }

  return new Date(parsed)
    .toLocaleDateString(getLanguage(), { day: 'numeric', month: 'short' })
    .replace(/\./g, '')
    .trim();
}
