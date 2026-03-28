import {
  detectAutoConversationLanguage,
  normalizeConversationLanguage,
  parseExplicitLanguageSwitch,
  resolveLanguageForTurn
} from './conversationLanguage';

describe('conversationLanguage', () => {
  it('normalizes short language codes to default locales', () => {
    expect(normalizeConversationLanguage('en')).toBe('en-CA');
    expect(normalizeConversationLanguage('es')).toBe('es-ES');
    expect(normalizeConversationLanguage('pt')).toBe('pt-BR');
  });

  it('parses explicit language switch aliases in French and English', () => {
    expect(parseExplicitLanguageSwitch('Parle en anglais stp')).toEqual({
      detected: true,
      language: 'en-CA'
    });

    expect(parseExplicitLanguageSwitch('Can you speak in spanish please?')).toEqual({
      detected: true,
      language: 'es-ES'
    });
  });

  it('parses explicit BCP-47 code switches', () => {
    expect(parseExplicitLanguageSwitch('switch to pt-BR')).toEqual({
      detected: true,
      language: 'pt-BR'
    });
  });

  it('flags explicit unknown language requests for clarification', () => {
    expect(parseExplicitLanguageSwitch('parle en klingon')).toEqual({
      detected: true,
      language: null
    });
  });

  it('detects non-latin scripts for auto language switching', () => {
    expect(detectAutoConversationLanguage('مرحبا كيف حالك اليوم', 'fr-CA')).toBe('ar-SA');
    expect(detectAutoConversationLanguage('Привет, как ты сегодня?', 'fr-CA')).toBe('ru-RU');
  });

  it('auto-detects English with confidence and avoids ambiguous switches', () => {
    expect(
      detectAutoConversationLanguage('Can you give me the weather and latest news today?', 'fr-CA')
    ).toBe('en-CA');
    expect(detectAutoConversationLanguage('bonjour hello merci', 'fr-CA')).toBeNull();
  });

  it('resolves language priority as explicit, then auto, then current', () => {
    expect(resolveLanguageForTurn('Can we continue in english?', 'fr-CA')).toEqual(
      expect.objectContaining({
        language: 'en-CA',
        source: 'explicit',
        requestKind: 'explicit_switch',
        persistLanguage: true,
        requiresConfirmation: false,
        explicitDetected: true,
        explicitRecognized: true
      })
    );

    expect(resolveLanguageForTurn('I need help with this today please', 'fr-CA')).toEqual(
      expect.objectContaining({
        language: 'en-CA',
        source: 'auto',
        requestKind: 'auto_candidate',
        persistLanguage: true,
        requiresConfirmation: true,
        explicitDetected: false
      })
    );

    expect(resolveLanguageForTurn('Parle en martien', 'fr-CA')).toEqual(
      expect.objectContaining({
        language: 'fr-CA',
        source: 'current',
        requestKind: 'current',
        persistLanguage: true,
        requiresConfirmation: false,
        explicitDetected: true,
        explicitRecognized: false
      })
    );
  });

  it('resolves explicit one-off phrase requests without persisting conversation language', () => {
    expect(resolveLanguageForTurn('Dis cette phrase en allemand: bonne journee!', 'fr-CA')).toEqual(
      expect.objectContaining({
        language: 'de-DE',
        source: 'explicit',
        requestKind: 'explicit_one_off',
        persistLanguage: false,
        requiresConfirmation: false,
        explicitDetected: true,
        explicitRecognized: true
      })
    );
  });

  it('flags unknown one-off explicit language requests for clarification', () => {
    expect(resolveLanguageForTurn('Traduis ca en klingon', 'fr-CA')).toEqual(
      expect.objectContaining({
        language: 'fr-CA',
        source: 'current',
        requestKind: 'current',
        explicitDetected: true,
        explicitRecognized: false
      })
    );
  });
});
