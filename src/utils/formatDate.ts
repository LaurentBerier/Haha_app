export function formatDate(iso: string): string {
  return new Date(iso).toLocaleTimeString();
}
