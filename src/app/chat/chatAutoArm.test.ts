import type { Message } from '../../models/Message';
import { resolveModeNudgeAutoArmDecision } from './chatAutoArm';

function buildArtistModeNudgeMessage(
  status: Message['status'] = 'complete',
  id = 'mode-nudge-msg'
): Message {
  return {
    id,
    conversationId: 'conv-1',
    role: 'artist',
    content: 'Intro du mode',
    status,
    timestamp: '2026-03-31T10:00:00.000Z',
    metadata: {
      injected: true,
      injectedType: 'mode_nudge'
    }
  };
}

function buildUserMessage(id = 'user-msg-1'): Message {
  return {
    id,
    conversationId: 'conv-1',
    role: 'user',
    content: 'Allo',
    status: 'complete',
    timestamp: '2026-03-31T10:00:01.000Z'
  };
}

describe('chatAutoArm', () => {
  it('returns eligible auto-arm for complete mode_nudge with no user turn in mode thread', () => {
    const decision = resolveModeNudgeAutoArmDecision({
      isValidConversation: true,
      conversationThreadType: 'mode',
      messages: [buildArtistModeNudgeMessage('complete', 'nudge-1')],
      conversationModeEnabled: true,
      hasStreaming: false,
      isQuotaBlocked: false,
      hasTypedDraft: false,
      isComposerDisabled: false
    });

    expect(decision).toEqual({
      candidateModeNudgeMessageId: 'nudge-1',
      shouldAutoArm: true,
      consumeCandidateWithoutAutoArm: false
    });
  });

  it('does not auto-arm when mode_nudge is not complete', () => {
    const decision = resolveModeNudgeAutoArmDecision({
      isValidConversation: true,
      conversationThreadType: 'mode',
      messages: [buildArtistModeNudgeMessage('pending', 'nudge-pending')],
      conversationModeEnabled: true,
      hasStreaming: false,
      isQuotaBlocked: false,
      hasTypedDraft: false,
      isComposerDisabled: false
    });

    expect(decision).toEqual({
      candidateModeNudgeMessageId: null,
      shouldAutoArm: false,
      consumeCandidateWithoutAutoArm: false
    });
  });

  it('does not auto-arm when the thread already has a user turn', () => {
    const decision = resolveModeNudgeAutoArmDecision({
      isValidConversation: true,
      conversationThreadType: 'mode',
      messages: [buildArtistModeNudgeMessage('complete', 'nudge-2'), buildUserMessage('user-1')],
      conversationModeEnabled: true,
      hasStreaming: false,
      isQuotaBlocked: false,
      hasTypedDraft: false,
      isComposerDisabled: false
    });

    expect(decision).toEqual({
      candidateModeNudgeMessageId: null,
      shouldAutoArm: false,
      consumeCandidateWithoutAutoArm: false
    });
  });

  it('does not auto-arm for non-mode threads', () => {
    const decision = resolveModeNudgeAutoArmDecision({
      isValidConversation: true,
      conversationThreadType: 'primary',
      messages: [buildArtistModeNudgeMessage('complete', 'nudge-primary')],
      conversationModeEnabled: true,
      hasStreaming: false,
      isQuotaBlocked: false,
      hasTypedDraft: false,
      isComposerDisabled: false
    });

    expect(decision).toEqual({
      candidateModeNudgeMessageId: null,
      shouldAutoArm: false,
      consumeCandidateWithoutAutoArm: false
    });
  });

  it('consumes candidate without auto-arm when conversation mode is off (manual override)', () => {
    const decision = resolveModeNudgeAutoArmDecision({
      isValidConversation: true,
      conversationThreadType: 'mode',
      messages: [buildArtistModeNudgeMessage('complete', 'nudge-manual-off')],
      conversationModeEnabled: false,
      hasStreaming: false,
      isQuotaBlocked: false,
      hasTypedDraft: false,
      isComposerDisabled: false
    });

    expect(decision).toEqual({
      candidateModeNudgeMessageId: 'nudge-manual-off',
      shouldAutoArm: false,
      consumeCandidateWithoutAutoArm: true
    });
  });
});
