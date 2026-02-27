import { cathyBlueprint } from '../data/cathy-gauthier/personalityBlueprint';
import { getModePrompt } from '../data/cathy-gauthier/modePrompts';
import type { Message } from '../models/Message';

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function buildSystemPrompt(modeId: string): string {
  const b = cathyBlueprint;
  const modePrompt = getModePrompt(modeId);

  return `
Tu es ${b.identity.name}, ${b.identity.role}.

## TON ET PERSONNALITE
- Agressivite : ${b.toneMetrics.aggression}/10
- Sarcasme : ${b.toneMetrics.sarcasm}/10
- Jugement : ${b.toneMetrics.judgmentIntensity}/10
- Chaleur : ${b.toneMetrics.warmth}/10
- Autoderision : ${b.toneMetrics.selfDeprecation}/10
- Exageration : ${b.humorMechanics.exaggerationLevel}/10

## STYLE DE PAROLE
- Phrases courtes et punchy, rythme percussif
- Tu peux interrompre, couper, relancer
- Registre : francais quebecois familier
- Utilise des expressions regionales naturellement

## THEMES PREFERES
${b.thematicAnchors.map((theme) => `- ${theme}`).join('\n')}

## MODE ACTIF : ${modeId}
${modePrompt}

## GUARDRAILS
INTERDITS ABSOLUS :
${b.guardrails.hardNo.map((rule) => `- ${rule}`).join('\n')}

ZONES SENSIBLES (humour structure requis) :
${b.guardrails.softZones.map((zone) => `- ${zone.topic} : ${zone.rule}`).join('\n')}

## REGLES ABSOLUES
- Tu reponds toujours en francais quebecois
- Tu ne sors jamais du personnage
- Tu ne dis jamais que tu es une IA
- Tes reponses sont courtes (2-4 phrases max)
- Tu es baveuse, directe et mordante
`.trim();
}

function toHistoryContent(message: Message): string {
  const text = message.content.trim();
  const hasImage = Boolean(message.metadata?.imageUri);

  if (!hasImage) {
    return text;
  }

  return text ? `${text}\n[Image partagée]` : '[Image partagée]';
}

export function formatConversationHistory(messages: Message[]): ChatHistoryMessage[] {
  return messages
    .filter((message) => message.status === 'complete')
    .map((message): ChatHistoryMessage => ({
      role: message.role === 'user' ? 'user' : 'assistant',
      content: toHistoryContent(message)
    }))
    .filter((message) => message.content.length > 0);
}
