import type { Conversation } from './Conversation';
import type { MessagePage } from './Message';

export interface PersistedStoreSnapshot {
  selectedArtistId: string | null;
  conversations: Record<string, Conversation[]>;
  activeConversationId: string | null;
  messagesByConversation: Record<string, MessagePage>;
  // Auth session is intentionally absent; Supabase SDK manages session persistence itself.
}
