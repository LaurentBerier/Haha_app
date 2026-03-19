import { resolveChatInputVoiceAction } from './chatInputVoiceAction';

describe('chatInputVoiceAction', () => {
  it('resolves send when payload is ready', () => {
    expect(
      resolveChatInputVoiceAction({
        canSend: true,
        hasConversationMode: true,
        isConversationEnabled: true,
        isConversationListening: true,
        isConversationPlaying: false
      })
    ).toBe('send');
  });

  it('resolves noop when conversation mode is unavailable', () => {
    expect(
      resolveChatInputVoiceAction({
        canSend: false,
        hasConversationMode: false,
        isConversationEnabled: false,
        isConversationListening: false,
        isConversationPlaying: false
      })
    ).toBe('noop');
  });

  it('resolves enable-and-listen when mode is off', () => {
    expect(
      resolveChatInputVoiceAction({
        canSend: false,
        hasConversationMode: true,
        isConversationEnabled: false,
        isConversationListening: false,
        isConversationPlaying: false
      })
    ).toBe('enable_and_listen');
  });

  it('resolves interrupt-and-listen while assistant is speaking', () => {
    expect(
      resolveChatInputVoiceAction({
        canSend: false,
        hasConversationMode: true,
        isConversationEnabled: true,
        isConversationListening: false,
        isConversationPlaying: true
      })
    ).toBe('interrupt_and_listen');
  });

  it('resolves pause when listening', () => {
    expect(
      resolveChatInputVoiceAction({
        canSend: false,
        hasConversationMode: true,
        isConversationEnabled: true,
        isConversationListening: true,
        isConversationPlaying: false
      })
    ).toBe('pause_listening');
  });

  it('resolves resume when mode is enabled but paused', () => {
    expect(
      resolveChatInputVoiceAction({
        canSend: false,
        hasConversationMode: true,
        isConversationEnabled: true,
        isConversationListening: false,
        isConversationPlaying: false
      })
    ).toBe('resume_listening');
  });
});
