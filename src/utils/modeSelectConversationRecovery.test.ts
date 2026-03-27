import { MODE_IDS } from '../config/constants';
import type { Conversation } from '../models/Conversation';
import {
  resolveModeSelectConversationRecoveryAction,
  sortPrimaryConversationsByRecency
} from './modeSelectConversationRecovery';

function createConversation(overrides: Partial<Conversation> = {}): Conversation {
  const timestamp = new Date('2026-03-22T12:00:00.000Z').toISOString();
  return {
    id: overrides.id ?? 'conv-default',
    artistId: overrides.artistId ?? 'cathy-gauthier',
    title: overrides.title ?? 'Conversation',
    language: overrides.language ?? 'fr-CA',
    modeId: overrides.modeId ?? MODE_IDS.ON_JASE,
    threadType: overrides.threadType ?? 'primary',
    createdAt: overrides.createdAt ?? timestamp,
    updatedAt: overrides.updatedAt ?? timestamp,
    lastMessagePreview: overrides.lastMessagePreview ?? ''
  };
}

describe('modeSelectConversationRecovery', () => {
  it('sorts primary conversations by recency and ignores mode threads', () => {
    const conversations = [
      createConversation({
        id: 'grill-latest',
        modeId: MODE_IDS.GRILL,
        threadType: 'mode',
        updatedAt: '2026-03-22T15:00:00.000Z'
      }),
      createConversation({
        id: 'primary-older',
        modeId: MODE_IDS.ON_JASE,
        threadType: 'primary',
        updatedAt: '2026-03-22T10:00:00.000Z'
      }),
      createConversation({
        id: 'primary-latest',
        modeId: MODE_IDS.ON_JASE,
        threadType: 'primary',
        updatedAt: '2026-03-22T14:00:00.000Z'
      })
    ];

    expect(sortPrimaryConversationsByRecency(conversations).map((conversation) => conversation.id)).toEqual([
      'primary-latest',
      'primary-older'
    ]);
  });

  it('returns use_existing with the latest primary conversation when available', () => {
    const conversations = [
      createConversation({
        id: 'primary-1',
        modeId: MODE_IDS.ON_JASE,
        threadType: 'primary',
        updatedAt: '2026-03-22T11:00:00.000Z'
      }),
      createConversation({
        id: 'primary-2',
        modeId: MODE_IDS.ON_JASE,
        threadType: 'primary',
        updatedAt: '2026-03-22T12:00:00.000Z'
      }),
      createConversation({ id: 'grill-1', modeId: MODE_IDS.GRILL, threadType: 'mode', updatedAt: '2026-03-22T13:00:00.000Z' })
    ];

    expect(resolveModeSelectConversationRecoveryAction(conversations)).toEqual({
      type: 'use_existing',
      conversationId: 'primary-2'
    });
  });

  it('returns create_new when no primary conversation exists', () => {
    const conversations = [
      createConversation({ id: 'grill-1', modeId: MODE_IDS.GRILL, threadType: 'mode', updatedAt: '2026-03-22T13:00:00.000Z' })
    ];

    expect(resolveModeSelectConversationRecoveryAction(conversations)).toEqual({
      type: 'create_new'
    });
  });
});
