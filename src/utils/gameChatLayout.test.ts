import { resolveGameChatWindowLayout } from './gameChatLayout';

describe('resolveGameChatWindowLayout', () => {
  it('uses measured protected area when inside clamp bounds', () => {
    const result = resolveGameChatWindowLayout({
      viewportHeight: 1000,
      composerOffset: 100,
      protectedAreaBottomY: 400
    });

    expect(result.conversationOverlayTop).toBe(407);
    expect(result.chatWindowMaxHeight).toBe(490);
    expect(result.screenPaddingBottom).toBe(604);
  });

  it('clamps overlay top to minimum ratio when protected area is too high on screen', () => {
    const result = resolveGameChatWindowLayout({
      viewportHeight: 1000,
      composerOffset: 100,
      protectedAreaBottomY: 20
    });

    expect(result.conversationOverlayTop).toBe(220);
  });

  it('clamps overlay top and enforces minimum chat height when protected area is very low', () => {
    const result = resolveGameChatWindowLayout({
      viewportHeight: 1000,
      composerOffset: 100,
      protectedAreaBottomY: 950
    });

    expect(result.conversationOverlayTop).toBe(820);
    expect(result.chatWindowMaxHeight).toBe(160);
    expect(result.screenPaddingBottom).toBe(274);
  });

  it('falls back to safe defaults on invalid numeric inputs', () => {
    const result = resolveGameChatWindowLayout({
      viewportHeight: 0,
      composerOffset: -1,
      protectedAreaBottomY: null
    });

    expect(result.conversationOverlayTop).toBe(400);
    expect(result.chatWindowMaxHeight).toBe(301);
    expect(result.screenPaddingBottom).toBe(411);
  });
});
