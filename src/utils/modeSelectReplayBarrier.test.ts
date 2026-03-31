import type { Message } from '../models/Message';
import { captureModeSelectReplayBarrier, deriveMessagesAfterReplayBarrier } from './modeSelectReplayBarrier';

function createMessage(overrides: Partial<Message> & { id: string }): Message {
  return {
    id: overrides.id,
    conversationId: overrides.conversationId ?? 'conv-primary',
    role: overrides.role ?? 'artist',
    content: overrides.content ?? `content-${overrides.id}`,
    status: overrides.status ?? 'complete',
    timestamp: overrides.timestamp ?? new Date('2026-03-30T12:00:00.000Z').toISOString(),
    metadata: overrides.metadata
  };
}

describe('modeSelectReplayBarrier', () => {
  it('captures the latest replayable artist message as replay barrier', () => {
    const messages: Message[] = [
      createMessage({
        id: 'artist-1',
        metadata: {
          voiceQueue: ['https://cdn.example.com/a.mp3']
        }
      }),
      createMessage({ id: 'user-1', role: 'user' }),
      createMessage({
        id: 'artist-2',
        metadata: {
          voiceUrl: 'https://cdn.example.com/b.mp3'
        }
      })
    ];

    expect(captureModeSelectReplayBarrier('conv-primary', messages)).toEqual({
      conversationId: 'conv-primary',
      messageId: 'artist-2'
    });
  });

  it('returns null barrier when no replayable artist message exists', () => {
    const messages: Message[] = [
      createMessage({ id: 'artist-no-voice', metadata: {} }),
      createMessage({ id: 'user-1', role: 'user' })
    ];

    expect(captureModeSelectReplayBarrier('conv-primary', messages)).toBeNull();
  });

  it('excludes messages up to the barrier and keeps newer messages only', () => {
    const messages: Message[] = [
      createMessage({
        id: 'artist-old',
        metadata: {
          voiceQueue: ['https://cdn.example.com/old.mp3']
        }
      }),
      createMessage({ id: 'user-after', role: 'user' }),
      createMessage({
        id: 'artist-new',
        metadata: {
          voiceQueue: ['https://cdn.example.com/new.mp3']
        }
      })
    ];

    const filtered = deriveMessagesAfterReplayBarrier({
      conversationId: 'conv-primary',
      messages,
      barrier: {
        conversationId: 'conv-primary',
        messageId: 'artist-old'
      }
    });

    expect(filtered.map((message) => message.id)).toEqual(['user-after', 'artist-new']);
  });

  it('ignores barrier when conversation changes so replay state resets safely', () => {
    const messages: Message[] = [
      createMessage({
        id: 'artist-keep',
        conversationId: 'conv-secondary',
        metadata: {
          voiceQueue: ['https://cdn.example.com/secondary.mp3']
        }
      })
    ];

    const filtered = deriveMessagesAfterReplayBarrier({
      conversationId: 'conv-secondary',
      messages,
      barrier: {
        conversationId: 'conv-primary',
        messageId: 'artist-old'
      }
    });

    expect(filtered).toEqual(messages);
  });
});
