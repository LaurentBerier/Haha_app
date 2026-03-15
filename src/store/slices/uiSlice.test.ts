jest.mock('../../i18n', () => ({
  setLanguage: jest.fn()
}));

import type { StoreState } from '../useStore';
import { createUiSlice } from './uiSlice';

function createSliceHarness<T>(initializer: (set: (partial: unknown) => void, get: () => StoreState) => T) {
  const state: Record<string, unknown> = {};
  const set = (partial: unknown) => {
    const next =
      typeof partial === 'function'
        ? (partial as (snapshot: Record<string, unknown>) => Record<string, unknown>)(state)
        : (partial as Record<string, unknown>);
    Object.assign(state, next);
  };
  const get = () => state as unknown as StoreState;

  Object.assign(state, initializer(set, get));
  return state as unknown as T & Record<string, unknown>;
}

describe('uiSlice', () => {
  it('updates reduce motion preference', () => {
    const slice = createSliceHarness((set, get) => createUiSlice(set as never, get as never, undefined as never));

    slice.setReduceMotion('on');
    expect(slice.reduceMotion).toBe('on');

    slice.setReduceMotion('off');
    expect(slice.reduceMotion).toBe('off');
  });

  it('toggles conversation mode and tracks greeted artists in-memory', () => {
    const slice = createSliceHarness((set, get) => createUiSlice(set as never, get as never, undefined as never));

    expect(slice.conversationModeEnabled).toBe(true);
    expect(slice.greetedArtistIds.has('cathy-gauthier')).toBe(false);
    expect(slice.queuedChatSendPayload).toBeNull();

    slice.setConversationModeEnabled(false);
    expect(slice.conversationModeEnabled).toBe(false);

    slice.markArtistGreeted('cathy-gauthier');
    expect(slice.greetedArtistIds.has('cathy-gauthier')).toBe(true);

    slice.queueChatSendPayload({
      conversationId: 'conv-1',
      nonce: 'nonce-1',
      payload: { text: 'allo' }
    });
    const queued = slice.consumeChatSendPayload('conv-1', 'nonce-1');
    expect(queued).toEqual({ text: 'allo' });
    expect(slice.queuedChatSendPayload).toBeNull();
  });
});
