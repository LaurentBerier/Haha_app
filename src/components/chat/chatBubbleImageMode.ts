import type { MessageMetadata } from '../../models/Message';

type MemeType = MessageMetadata['memeType'];

export type ChatBubbleImageResizeMode = 'cover' | 'contain';

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

export function shouldUseMemeImageStyle(params: {
  hasImage: boolean;
  memeType: MemeType | undefined;
}): boolean {
  if (!params.hasImage) {
    return false;
  }

  return isMemeImageType(params.memeType);
}
