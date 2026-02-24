import type { Conversation } from './Conversation';
import type { MessagePage } from './Message';
import type { Subscription } from './Subscription';
import type { UsageQuota } from './Usage';

export interface PersistedStoreSnapshot {
  selectedArtistId: string | null;
  conversations: Record<string, Conversation[]>;
  activeConversationId: string | null;
  messagesByConversation: Record<string, MessagePage>;
  subscription: Subscription;
  unlockedArtistIds: string[];
  quota: UsageQuota;
}

export interface SecureStoreSnapshot {
  subscription: Subscription;
  unlockedArtistIds: string[];
}
