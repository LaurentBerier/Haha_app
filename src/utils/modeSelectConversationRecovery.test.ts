import { MODE_IDS } from '../config/constants';
import type { Conversation } from '../models/Conversation';
import {
  resolveModeSelectConversationRecoveryAction,
  sortOnJaseConversationsByRecency
} from './modeSelectConversationRecovery';

function createConversation(overrides: Partial<Conversation> = {}): Conversation {
  const timestamp = new Date('2026-03-22T12:00:00.000Z').toISOString();
  return {
    id: overrides.id ?? 'conv-default',
    artistId: overrides.artistId ?? 'cathy-gauthier',
    title: overrides.title ?? 'Conversation',
    language: overrides.language ?? 'fr-CA',
    modeId: overrides.modeId ?? MODE_IDS.ON_JASE,
    createdAt: overrides.createdAt ?? timestamp,
    updatedAt: overrides.updatedAt ?? timestamp,
    lastMessagePreview: overrides.lastMessagePreview ?? ''
  };
}

describe('modeSelectConversationRecovery', () => {
  it('sorts On Jase conversations by recency and ignores other modes', () => {
    const conversations = [
      createConversation({ id: 'grill-latest', modeId: MODE_IDS.GRILL, updatedAt: '2026-03-22T15:00:00.000Z' }),
      createConversation({ id: 'on-jase-older', modeId: MODE_IDS.ON_JASE, updatedAt: '2026-03-22T10:00:00.000Z' }),
      createConversation({ id: 'on-jase-latest', modeId: MODE_IDS.ON_JASE, updatedAt: '2026-03-22T14:00:00.000Z' })
    ];

    expect(sortOnJaseConversationsByRecency(conversations).map((conversation) => conversation.id)).toEqual([
      'on-jase-latest',
      'on-jase-older'
    ]);
  });

  it('returns use_existing with the latest On Jase conversation when available', () => {
    const conversations = [
      createConversation({ id: 'on-jase-1', modeId: MODE_IDS.ON_JASE, updatedAt: '2026-03-22T11:00:00.000Z' }),
      createConversation({ id: 'on-jase-2', modeId: MODE_IDS.ON_JASE, updatedAt: '2026-03-22T12:00:00.000Z' }),
      createConversation({ id: 'grill-1', modeId: MODE_IDS.GRILL, updatedAt: '2026-03-22T13:00:00.000Z' })
    ];

    expect(resolveModeSelectConversationRecoveryAction(conversations)).toEqual({
      type: 'use_existing',
      conversationId: 'on-jase-2'
    });
  });

  it('returns create_new when no On Jase conversation exists', () => {
    const conversations = [
      createConversation({ id: 'grill-1', modeId: MODE_IDS.GRILL, updatedAt: '2026-03-22T13:00:00.000Z' })
    ];

    expect(resolveModeSelectConversationRecoveryAction(conversations)).toEqual({
      type: 'create_new'
    });
  });
});
