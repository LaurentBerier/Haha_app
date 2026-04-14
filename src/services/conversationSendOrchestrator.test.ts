import type { Conversation } from '../models/Conversation';
import * as experienceLaunchService from './experienceLaunchService';
import {
  attemptExperienceLaunchBeforeSend,
  planGlobalComposerSend,
  resolveConversationIdForGlobalComposerSend
} from './conversationSendOrchestrator';

jest.mock('./experienceLaunchService', () => ({
  tryLaunchExperienceFromText: jest.fn(() => ({ launched: false }))
}));

const baseConversation = (overrides: Partial<Conversation>): Conversation => ({
  id: 'c1',
  artistId: 'artist-1',
  title: 't',
  language: 'fr',
  modeId: 'on-jase',
  threadType: 'primary',
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  lastMessagePreview: '',
  ...overrides
});

describe('conversationSendOrchestrator', () => {
  beforeEach(() => {
    jest.mocked(experienceLaunchService.tryLaunchExperienceFromText).mockReturnValue({ launched: false });
  });

  it('attemptExperienceLaunchBeforeSend skips when image is present', () => {
    const outcome = attemptExperienceLaunchBeforeSend({
      artistId: 'a',
      text: 'hello',
      image: { uri: 'x' },
      fallbackLanguage: 'fr'
    });
    expect(outcome.launched).toBe(false);
    expect(experienceLaunchService.tryLaunchExperienceFromText).not.toHaveBeenCalled();
  });

  it('resolveConversationIdForGlobalComposerSend reuses primary without user messages on mode-select', () => {
    const conversations = {
      'artist-1': [baseConversation({ id: 'primary-1', threadType: 'primary' })]
    };
    const id = resolveConversationIdForGlobalComposerSend({
      pathname: '/mode-select/artist-1',
      artistId: 'artist-1',
      conversations,
      activeConversationId: 'primary-1',
      hasUserMessageInConversation: () => false,
      createConversation: jest.fn(),
      language: 'fr'
    });
    expect(id).toBe('primary-1');
  });

  it('resolveConversationIdForGlobalComposerSend creates conversation when none match', () => {
    const createConversation = jest.fn().mockReturnValue({ id: 'new-id' });
    const id = resolveConversationIdForGlobalComposerSend({
      pathname: '/stats',
      artistId: 'artist-1',
      conversations: {},
      activeConversationId: null,
      hasUserMessageInConversation: () => false,
      createConversation,
      language: 'fr'
    });
    expect(id).toBe('new-id');
    expect(createConversation).toHaveBeenCalled();
  });

  it('planGlobalComposerSend returns launched when experience text matches', () => {
    jest.mocked(experienceLaunchService.tryLaunchExperienceFromText).mockReturnValue({ launched: true, targetId: 'x' });
    const plan = planGlobalComposerSend({
      payload: { text: '  meme  ', image: null },
      targetArtistId: 'artist-1',
      pathname: '/',
      language: 'fr',
      conversations: {},
      activeConversationId: null,
      hasUserMessageInConversation: () => false,
      createConversation: jest.fn()
    });
    expect(plan).toEqual({ action: 'launched' });
  });

  it('planGlobalComposerSend returns send with nonce and normalized payload', () => {
    const createConversation = jest.fn().mockReturnValue({ id: 'cid' });
    const plan = planGlobalComposerSend({
      payload: { text: '  hi  ', image: null },
      targetArtistId: 'artist-1',
      pathname: '/stats',
      language: 'fr',
      conversations: {},
      activeConversationId: null,
      hasUserMessageInConversation: () => false,
      createConversation
    });
    expect(plan.action).toBe('send');
    if (plan.action !== 'send') {
      return;
    }
    expect(plan.conversationId).toBe('cid');
    expect(plan.payload.text).toBe('hi');
    expect(plan.nonce.length).toBeGreaterThan(4);
  });
});
