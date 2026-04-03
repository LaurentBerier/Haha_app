import {
  DEFAULT_CONVERSATION_THREAD_TYPE,
  normalizeConversationThreadType
} from './Conversation';

describe('Conversation threadType normalization', () => {
  it('keeps primary thread type when explicitly provided', () => {
    expect(normalizeConversationThreadType('primary')).toBe('primary');
  });

  it('keeps secondary thread type when explicitly provided', () => {
    expect(normalizeConversationThreadType('secondary')).toBe('secondary');
  });

  it('falls back to mode for legacy or invalid values', () => {
    expect(normalizeConversationThreadType(undefined)).toBe(DEFAULT_CONVERSATION_THREAD_TYPE);
    expect(normalizeConversationThreadType(null)).toBe(DEFAULT_CONVERSATION_THREAD_TYPE);
    expect(normalizeConversationThreadType('mode')).toBe(DEFAULT_CONVERSATION_THREAD_TYPE);
    expect(normalizeConversationThreadType('unexpected')).toBe(DEFAULT_CONVERSATION_THREAD_TYPE);
  });
});
