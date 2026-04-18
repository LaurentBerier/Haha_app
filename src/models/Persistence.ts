import type { Conversation } from './Conversation';
import type { GamificationStats } from './Gamification';
import type { MessagePage } from './Message';

export interface PersistedUiPreferences {
  language: 'fr-CA' | 'en-CA';
  displayMode: 'dark' | 'light' | 'system';
  reduceMotion: 'system' | 'on' | 'off';
  voiceAutoPlay: boolean;
  emojiStyle?: 'off' | 'classic' | 'full';
  conversationModeEnabled: boolean;
  completedTutorials?: Record<string, boolean>;
}

export type PersistedConversation = Conversation;

export interface PersistedStoreSnapshot {
  ownerUserId?: string | null;
  selectedArtistId: string | null;
  conversations: Record<string, PersistedConversation[]>;
  activeConversationId: string | null;
  messagesByConversation: Record<string, MessagePage>;
  gamification?: Partial<GamificationStats>;
  preferences?: Partial<PersistedUiPreferences>;
  modeSelectSessionHubConversationByArtist?: Record<string, string>;
  greetedArtistIds?: string[];
  // Auth session is intentionally absent; Supabase SDK manages session persistence itself.
}
