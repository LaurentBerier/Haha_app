import type { MessageMetadata } from '../../models/Message';

type MemeType = MessageMetadata['memeType'];

export type ChatBubbleImageResizeMode = 'cover' | 'contain';
export type ChatBubbleImageDisplayVariant = 'default' | 'meme';

function isMemeImageType(memeType: MemeType | undefined): boolean {
  return memeType === 'option' || memeType === 'final';
}

export function resolveChatBubbleImageResizeMode(params: {
  hasImage: boolean;
  memeType: MemeType | undefined;
}): ChatBubbleImageResizeMode | null {
  if (!params.hasImage) {
    return null;
  }

  return isMemeImageType(params.memeType) ? 'contain' : 'cover';
}

export function resolveChatBubbleImageDisplayVariant(params: {
  hasImage: boolean;
  memeType: MemeType | undefined;
}): ChatBubbleImageDisplayVariant {
  if (!params.hasImage) {
    return 'default';
  }

  return isMemeImageType(params.memeType) ? 'meme' : 'default';
}
