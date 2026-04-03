import type { Message } from '../models/Message';
import {
  findLatestReplayableArtistMessage,
  findReplayableArtistMessageById,
  shouldReplayArtistMessage
} from './voiceReplay';

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

  it('can exclude a replayable message id when finding the latest replay target', () => {
    const messages: Message[] = [
      createMessage({ id: 'm1', role: 'artist', metadata: { voiceUrl: 'https://example.com/old.mp3' } }),
      createMessage({ id: 'm2', role: 'artist', metadata: { voiceUrl: 'https://example.com/new.mp3' } })
    ];

    expect(findLatestReplayableArtistMessage(messages, { excludeMessageId: 'm2' })).toEqual({
      messageId: 'm1',
      uris: ['https://example.com/old.mp3']
    });
  });

  it('finds replayable message by id', () => {
    const messages: Message[] = [
      createMessage({ id: 'm1', role: 'artist', metadata: { voiceUrl: 'https://example.com/old.mp3' } }),
      createMessage({ id: 'm2', role: 'artist', metadata: { voiceQueue: ['https://example.com/new.mp3'] } })
    ];

    expect(findReplayableArtistMessageById(messages, 'm2')).toEqual({
      messageId: 'm2',
      uris: ['https://example.com/new.mp3']
    });
  });

  it('returns null when replayable message by id is missing or not replayable', () => {
    const messages: Message[] = [
      createMessage({ id: 'm1', role: 'artist', status: 'streaming', metadata: { voiceUrl: 'https://example.com/live.mp3' } }),
      createMessage({ id: 'm2', role: 'artist', metadata: {} })
    ];

    expect(findReplayableArtistMessageById(messages, 'm1')).toBeNull();
    expect(findReplayableArtistMessageById(messages, 'm2')).toBeNull();
    expect(findReplayableArtistMessageById(messages, 'missing')).toBeNull();
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
