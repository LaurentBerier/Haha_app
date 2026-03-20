import { resolveChatInputVoiceAction, runChatInputVoiceAction } from './chatInputVoiceAction';

describe('chatInputVoiceAction', () => {
  it('resolves send when payload is ready', () => {
    expect(
      resolveChatInputVoiceAction({
        canSend: true,
        hasConversationMode: true,
        isConversationEnabled: true,
        micState: 'listening'
      })
    ).toBe('send');
  });

  it('resolves noop when conversation mode is unavailable', () => {
    expect(
      resolveChatInputVoiceAction({
        canSend: false,
        hasConversationMode: false,
        isConversationEnabled: false,
        micState: 'off'
      })
    ).toBe('noop');
  });

  it('resolves enable-and-listen when mode is off', () => {
    expect(
      resolveChatInputVoiceAction({
        canSend: false,
        hasConversationMode: true,
        isConversationEnabled: false,
        micState: 'off'
      })
    ).toBe('enable_and_listen');
  });

  it('resolves pause while the assistant is speaking', () => {
    expect(
      resolveChatInputVoiceAction({
        canSend: false,
        hasConversationMode: true,
        isConversationEnabled: true,
        micState: 'assistant_busy'
      })
    ).toBe('pause_listening');
  });

  it('resolves pause when listening', () => {
    expect(
      resolveChatInputVoiceAction({
        canSend: false,
        hasConversationMode: true,
        isConversationEnabled: true,
        micState: 'listening'
      })
    ).toBe('pause_listening');
  });

  it('resolves pause while mic is recovering', () => {
    expect(
      resolveChatInputVoiceAction({
        canSend: false,
        hasConversationMode: true,
        isConversationEnabled: true,
        micState: 'recovering'
      })
    ).toBe('pause_listening');
  });

  it('resolves resume when mode is enabled but paused', () => {
    expect(
      resolveChatInputVoiceAction({
        canSend: false,
        hasConversationMode: true,
        isConversationEnabled: true,
        micState: 'paused_manual'
      })
    ).toBe('resume_listening');
  });

  it('invokes send handler for send action', () => {
    const handlers = {
      onSend: jest.fn(),
      onEnableAndListen: jest.fn(),
      onPauseListening: jest.fn(),
      onResumeListening: jest.fn()
    };

    runChatInputVoiceAction('send', handlers);

    expect(handlers.onSend).toHaveBeenCalledTimes(1);
    expect(handlers.onEnableAndListen).not.toHaveBeenCalled();
    expect(handlers.onPauseListening).not.toHaveBeenCalled();
    expect(handlers.onResumeListening).not.toHaveBeenCalled();
  });

  it('invokes pause and resume handlers for pause and resume actions', () => {
    const handlers = {
      onSend: jest.fn(),
      onEnableAndListen: jest.fn(),
      onPauseListening: jest.fn(),
      onResumeListening: jest.fn()
    };

    runChatInputVoiceAction('pause_listening', handlers);
    runChatInputVoiceAction('resume_listening', handlers);

    expect(handlers.onPauseListening).toHaveBeenCalledTimes(1);
    expect(handlers.onResumeListening).toHaveBeenCalledTimes(1);
    expect(handlers.onSend).not.toHaveBeenCalled();
    expect(handlers.onEnableAndListen).not.toHaveBeenCalled();
  });
});
