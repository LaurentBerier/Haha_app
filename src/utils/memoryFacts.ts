import type { StoreState } from '../store/useStore';

export const MAX_MEMORY_FACTS = 10;

function normalizeMemoryFact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function pushUniqueFacts(
  sourceFacts: string[],
  seen: Set<string>,
  target: string[],
  limit: number
): boolean {
  for (const fact of sourceFacts) {
    const normalizedFact = normalizeMemoryFact(fact);
    if (!normalizedFact) {
      continue;
    }

    const key = normalizedFact.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    target.push(normalizedFact);
    if (target.length >= limit) {
      return true;
    }
  }

  return false;
}

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
  state: StoreState,
  artistId: string,
  currentConversationId: string
): string[] {
  const conversations = state.conversations[artistId] ?? [];
  const seen = new Set<string>();
  const facts: string[] = [];

  const persistedFacts = Array.isArray(state.userProfile?.memoryFacts) ? state.userProfile.memoryFacts : [];
  if (pushUniqueFacts(persistedFacts, seen, facts, MAX_MEMORY_FACTS)) {
    return facts;
  }

  if (conversations.length === 0) {
    return facts;
  }

  const sortedConversationIds = conversations
    .slice()
    .sort((a, b) => {
      const aTime = Date.parse(a.updatedAt);
      const bTime = Date.parse(b.updatedAt);
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    })
    .map((conversation) => conversation.id);

  const normalizedCurrentConversationId = typeof currentConversationId === 'string' ? currentConversationId.trim() : '';
  if (normalizedCurrentConversationId && !sortedConversationIds.includes(normalizedCurrentConversationId)) {
    sortedConversationIds.unshift(normalizedCurrentConversationId);
  }

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
      if (pushUniqueFacts(extractedFacts, seen, facts, MAX_MEMORY_FACTS)) {
        return facts;
      }
    }
  }

  return facts;
}
