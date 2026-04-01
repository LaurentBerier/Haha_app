export type MessageStatus = 'pending' | 'streaming' | 'complete' | 'error';
export type MessageRole = 'user' | 'artist';

export interface GreetingActivitySnapshot {
  punchlinesCreated: number;
  battleWins: number;
  memesGenerated: number;
  photosRoasted: number;
  roastsGenerated: number;
  capturedAt: string;
}

export interface MessageMetadata {
  tokensUsed?: number;
  voiceUrl?: string;
  voiceQueue?: string[];
  voiceChunkBoundaries?: number[];
  voiceStatus?: 'generating' | 'ready' | 'unavailable';
  voiceErrorCode?: string;
  cathyReaction?: string;
  tutorialMode?: boolean;
  injectedType?: 'greeting' | 'tutorial_greeting' | 'mode_nudge';
  imageUri?: string;
  imageMediaType?: string;
  errorMessage?: string;
  errorCode?: string;
  battleResult?: 'light' | 'solid' | 'destruction';
  injected?: boolean;
  showUpgradeCta?: boolean;
  upgradeFromTier?: string;
  greetingActivitySnapshot?: GreetingActivitySnapshot;
  memeType?: 'upload_prompt' | 'option' | 'final';
  memeDraftId?: string;
  memeOptionId?: string;
  memeOptionRank?: number;
  memeCaption?: string;
  memePlacement?: 'top' | 'bottom';
  memeLogoPlacement?: 'left' | 'right';
  memeSelected?: boolean;
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  timestamp: string;
  metadata?: MessageMetadata;
}

export interface MessagePage {
  messages: Message[];
  hasMore: boolean;
  cursor: string | null;
  messageIndexById?: Record<string, number>;
}
