const DAILY_TOPICS = [
  'les reunions Zoom infinies',
  'les influenceurs qui vendent tout et rien',
  'les brunch people du dimanche',
  'les messages passifs-agressifs au travail',
  'les gym bros qui donnent des conseils non demandes',
  'les commentaires Facebook de mononcles',
  'les stories de voyage en 48 parties',
  'les gens qui disent "on se fait un call rapide"',
  'les pseudo experts en relation sur TikTok',
  'les groupes WhatsApp de famille',
  'les files d attente absurdement longues',
  'les couples qui se chicanent en public'
] as const;

function hashDate(dateKey: string): number {
  let hash = 0;
  for (const char of dateKey) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function toDateKey(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function getDailyTopic(referenceDate = new Date()): string {
  const key = toDateKey(referenceDate);
  const index = hashDate(key) % DAILY_TOPICS.length;
  return DAILY_TOPICS[index] ?? DAILY_TOPICS[0];
}
