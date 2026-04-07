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
    const nameBeat = shouldAcknowledgeName ? " That name though - I've got questions, but we'll get to that." : '';
    return `${intro}${nameBeat} ${TUTORIAL_MIC_PARAGRAPH_EN}`;
  }

  const intro = trimmedPreferred ? `Hey ${trimmedPreferred}, comment tu vas?` : 'Hey, comment tu vas?';
  const nameBeat = shouldAcknowledgeName ? ' Ton prénom, j\'ai des questions - mais on réglera ça plus tard.' : '';
  return `${intro}${nameBeat} ${TUTORIAL_MIC_PARAGRAPH_FR}`;
}
