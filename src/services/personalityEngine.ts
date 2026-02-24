import type { Artist } from '../models/Artist';
import type { Message } from '../models/Message';
import { MAX_HISTORY_MESSAGES } from '../config/constants';

export interface AssemblePromptParams {
  artist: Artist;
  conversationHistory: Message[];
  userMessage: string;
  language: string;
  contextSignals?: Record<string, unknown>;
}

function formatHistory(history: Message[]): string {
  if (!history.length) {
    return 'Aucun historique pertinent.';
  }

  return history
    .slice(-MAX_HISTORY_MESSAGES)
    .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
    .join('\n');
}

export function assemblePrompt(params: AssemblePromptParams): { systemPrompt: string; userTurn: string } {
  const { artist, conversationHistory, userMessage, language, contextSignals } = params;
  const profile = artist.personalityProfile;

  const identityBlock = `IDENTITE:\nTu es ${artist.name}, artiste de scene en mode conversationnel authentique.`;
  const toneBlock = [
    'TON:',
    `- Agressivite: ${profile.toneMetrics.aggression}/10`,
    `- Chaleur: ${profile.toneMetrics.warmth}/10`,
    `- Sarcasme: ${profile.toneMetrics.sarcasm}/10`,
    `- Absurdite: ${profile.toneMetrics.absurdity}/10`,
    `- Tolerance vulgarite: ${profile.toneMetrics.vulgarityTolerance}/10`,
    `- Intensite du jugement: ${profile.toneMetrics.judgmentIntensity}/10`,
    `- Auto-derision: ${profile.toneMetrics.selfDeprecation}/10`
  ].join('\n');

  const humorBlock = [
    'MECANIQUE D HUMOUR:',
    `- Escalade: ${profile.humorMechanics.escalationStyle}`,
    `- Delai punchline: ${profile.humorMechanics.punchlineDelay}`,
    `- Repetition: ${profile.humorMechanics.repetitionUsage}`,
    `- Exageration: ${profile.humorMechanics.exaggerationLevel}/10`,
    `- Contraste: ${profile.humorMechanics.contrastHumor}`,
    `- Confrontation public: ${profile.humorMechanics.audienceConfrontation}`
  ].join('\n');

  const speechBlock = [
    'PAROLE:',
    `- Longueur phrases: ${profile.speechPattern.averageSentenceLength}`,
    `- Interruptions naturelles: ${profile.speechPattern.interruptionStyle ? 'oui' : 'non'}`,
    `- Rythme: ${profile.speechPattern.rhythmStyle}`,
    `- Regionalismes: ${profile.speechPattern.regionalisms}`
  ].join('\n');

  const thematicAnchorsBlock = `THEMES:\n${profile.thematicAnchors.map((theme) => `- ${theme}`).join('\n')}`;

  const guardrailsBlock = [
    'GARDE-FOUS:',
    ...profile.guardrails.hardNo.map((rule) => `- INTERDIT: ${rule}`),
    ...profile.guardrails.softZones.map((zone) => `- SENSIBLE ${zone.topic}: ${zone.rule}`)
  ].join('\n');

  const languageBlock = `LANGUE:\n- Langue cible: ${language}\n- Respecte le registre conversationnel local.`;
  const conversationContextBlock = `CONTEXTE CONVERSATION:\n${formatHistory(conversationHistory)}`;

  const signalBlock = contextSignals
    ? `SIGNAUX CONTEXTE:\n${Object.entries(contextSignals)
        .map(([key, value]) => `- ${key}: ${String(value)}`)
        .join('\n')}`
    : 'SIGNAUX CONTEXTE:\n- Aucun signal additionnel.';

  const responseDirectiveBlock = [
    'DIRECTIVE REPONSE:',
    '- Reponse concise, percutante, et coherent avec le personnage.',
    '- Une structure claire avec un angle comique construit.',
    '- Rester sure et respectueuse des garde-fous.'
  ].join('\n');

  const blocks = [
    identityBlock,
    toneBlock,
    humorBlock,
    speechBlock,
    thematicAnchorsBlock,
    guardrailsBlock,
    languageBlock,
    conversationContextBlock,
    signalBlock,
    responseDirectiveBlock
  ];

  return {
    systemPrompt: blocks.join('\n\n'),
    userTurn: userMessage.trim()
  };
}
