import type { Conversation } from './Conversation';
import type { GamificationStats } from './Gamification';
import type { MessagePage } from './Message';

export interface PersistedUiPreferences {
  language: 'fr-CA' | 'en-CA';
  displayMode: 'dark' | 'light' | 'system';
  reduceMotion: 'system' | 'on' | 'off';
}

export interface PersistedStoreSnapshot {
  ownerUserId?: string | null;
  selectedArtistId: string | null;
  conversations: Record<string, Conversation[]>;
  activeConversationId: string | null;
  messagesByConversation: Record<string, MessagePage>;
  gamification?: Partial<GamificationStats>;
  preferences?: Partial<PersistedUiPreferences>;
  // Auth session is intentionally absent; Supabase SDK manages session persistence itself.
}
