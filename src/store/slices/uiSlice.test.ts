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
    expect(slice.voiceAutoPlay).toBe(true);
    expect(slice.greetedArtistIds.has('cathy-gauthier')).toBe(false);
    expect(slice.completedTutorials).toEqual({});

    slice.markTutorialCompleted('greeting');
    expect(slice.completedTutorials.greeting).toBe(true);
    slice.markTutorialCompleted('greeting');
    expect(Object.keys(slice.completedTutorials).length).toBe(1);

    expect(slice.queuedChatSendPayload).toBeNull();
    expect(slice.modeSelectSessionHubConversationByArtist).toEqual({});
    expect(slice.sessionExperienceEventsByArtist).toEqual({});

    slice.setConversationModeEnabled(false);
    expect(slice.conversationModeEnabled).toBe(false);

    slice.markArtistGreeted('cathy-gauthier');
    expect(slice.greetedArtistIds.has('cathy-gauthier')).toBe(true);

    slice.setModeSelectSessionHubConversation('cathy-gauthier', 'conv-hub-1');
    expect(slice.modeSelectSessionHubConversationByArtist['cathy-gauthier']).toBe('conv-hub-1');

    slice.trackSessionExperienceEvent({
      artistId: 'cathy-gauthier',
      experienceType: 'mode',
      experienceId: 'grill',
      occurredAt: '2026-03-31T11:40:00.000Z'
    });
    expect(slice.sessionExperienceEventsByArtist['cathy-gauthier']).toEqual([
      expect.objectContaining({
        artistId: 'cathy-gauthier',
        experienceType: 'mode',
        experienceId: 'grill'
      })
    ]);

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
