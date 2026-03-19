import type { Message } from '../models/Message';
import { findLatestReplayableArtistMessage, shouldReplayArtistMessage } from './voiceReplay';

function createMessage(partial: Partial<Message> & Pick<Message, 'id'>): Message {
  return {
    id: partial.id,
    conversationId: partial.conversationId ?? 'conv-1',
    role: partial.role ?? 'artist',
    content: partial.content ?? '',
    status: partial.status ?? 'complete',
    timestamp: partial.timestamp ?? '2026-03-19T00:00:00.000Z',
    metadata: partial.metadata
  };
}

describe('voiceReplay', () => {
  it('returns the latest artist message with a replayable queue', () => {
    const messages: Message[] = [
      createMessage({ id: 'm1', role: 'artist', metadata: { voiceUrl: 'https://example.com/old.mp3' } }),
      createMessage({ id: 'm2', role: 'artist', metadata: { voiceQueue: ['https://example.com/new-a.mp3', 'https://example.com/new-b.mp3'] } })
    ];

    expect(findLatestReplayableArtistMessage(messages)).toEqual({
      messageId: 'm2',
      uris: ['https://example.com/new-a.mp3', 'https://example.com/new-b.mp3']
    });
  });

  it('skips non-complete or non-artist messages', () => {
    const messages: Message[] = [
      createMessage({ id: 'm1', role: 'user', metadata: { voiceUrl: 'https://example.com/user.mp3' } }),
      createMessage({ id: 'm2', role: 'artist', status: 'streaming', metadata: { voiceUrl: 'https://example.com/stream.mp3' } }),
      createMessage({ id: 'm3', role: 'artist', metadata: { voiceUrl: 'https://example.com/final.mp3' } })
    ];

    expect(findLatestReplayableArtistMessage(messages)).toEqual({
      messageId: 'm3',
      uris: ['https://example.com/final.mp3']
    });
  });

  it('replays only once per message id', () => {
    const candidate = {
      messageId: 'm9',
      uris: ['https://example.com/m9.mp3']
    };

    expect(shouldReplayArtistMessage(null, candidate)).toBe(true);
    expect(shouldReplayArtistMessage('m8', candidate)).toBe(true);
    expect(shouldReplayArtistMessage('m9', candidate)).toBe(false);
    expect(shouldReplayArtistMessage('m9', null)).toBe(false);
  });
});
