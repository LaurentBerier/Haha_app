import type { StoreState } from '../store/useStore';

export const MAX_MEMORY_FACTS = 6;

export function extractMemoryFactsFromText(text: string): string[] {
  const normalized = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  if (!normalized) {
    return [];
  }

  const firstPersonPattern =
    /\b(je|j'|moi|mon|ma|mes|j'aime|j adore|je suis|je travaille|je vis|je prefere|i|i'm|i am|my|me|i like|i love)\b/i;

  return normalized
    .split(/[\n.!?]/g)
    .map((line) => line.trim())
    .filter((line) => line.length >= 10 && line.length <= 140)
    .filter((line) => firstPersonPattern.test(line));
}

export function collectArtistMemoryFacts(
  state: ReturnType<() => StoreState>,
  artistId: string,
  currentConversationId: string
): string[] {
  const conversations = state.conversations[artistId] ?? [];
  if (conversations.length === 0) {
    return [];
  }

  const sortedConversationIds = conversations
    .slice()
    .sort((a, b) => {
      const aTime = Date.parse(a.updatedAt);
      const bTime = Date.parse(b.updatedAt);
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    })
    .map((conversation) => conversation.id);

  if (!sortedConversationIds.includes(currentConversationId)) {
    sortedConversationIds.unshift(currentConversationId);
  }

  const seen = new Set<string>();
  const facts: string[] = [];

  for (const conversationId of sortedConversationIds) {
    const page = state.messagesByConversation[conversationId];
    if (!page || !Array.isArray(page.messages) || page.messages.length === 0) {
      continue;
    }

    for (let index = page.messages.length - 1; index >= 0; index -= 1) {
      const message = page.messages[index];
      if (!message) {
        continue;
      }
      if (message.role !== 'user' || message.status !== 'complete' || !message.content.trim()) {
        continue;
      }

      const extractedFacts = extractMemoryFactsFromText(message.content);
      for (const fact of extractedFacts) {
        const key = fact.toLowerCase();
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        facts.push(fact);
        if (facts.length >= MAX_MEMORY_FACTS) {
          return facts;
        }
      }
    }
  }

  return facts;
}
