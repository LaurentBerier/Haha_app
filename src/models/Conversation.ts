export interface Conversation {
  id: string;
  userId?: string;
  artistId: string;
  title: string;
  language: string;
  modeId: string;
  createdAt: string;
  updatedAt: string;
  lastMessagePreview: string;
}
