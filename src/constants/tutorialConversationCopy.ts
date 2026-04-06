import tutorialMic from './tutorialConversationMic.json';

/** Persisted tutorial id for the mode-select / conversation onboarding greeting. */
export const TUTORIAL_CONVERSATION_GREETING_ID = 'greeting';

export const TUTORIAL_MIC_PARAGRAPH_EN = tutorialMic.micParagraphEn;
export const TUTORIAL_MIC_PARAGRAPH_FR = tutorialMic.micParagraphFr;

export function getTutorialMicParagraph(language: string): string {
  return language.toLowerCase().startsWith('en') ? TUTORIAL_MIC_PARAGRAPH_EN : TUTORIAL_MIC_PARAGRAPH_FR;
}

/**
 * Full tutorial greeting for conversation mode (matches client fallback + API forced path).
 * `nameStyle` must match `classifyGreetingNameStyle(preferredName)` from the caller.
 */
export function buildTutorialConversationGreeting(
  language: string,
  preferredName: string | null,
  nameStyle: 'normal' | 'unusual'
): string {
  const isEnglish = language.toLowerCase().startsWith('en');
  const trimmedPreferred = typeof preferredName === 'string' ? preferredName.trim() : '';
  const shouldAcknowledgeName = Boolean(trimmedPreferred) && nameStyle === 'unusual';

  if (isEnglish) {
    const intro = trimmedPreferred ? `Hey ${trimmedPreferred}, how are you?` : 'Hey, how are you?';
    const nameBeat = shouldAcknowledgeName ? ' Your name is unique and I love it.' : '';
    return `${intro}${nameBeat} ${TUTORIAL_MIC_PARAGRAPH_EN}`;
  }

  const intro = trimmedPreferred ? `Hey ${trimmedPreferred}, comment tu vas?` : 'Hey, comment tu vas?';
  const nameBeat = shouldAcknowledgeName ? " Ton prénom est original, j'aime ça." : '';
  return `${intro}${nameBeat} ${TUTORIAL_MIC_PARAGRAPH_FR}`;
}
