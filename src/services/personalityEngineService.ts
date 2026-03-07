import { cathyBlueprint } from '../data/cathy-gauthier/personalityBlueprint';
import { getModePrompt } from '../data/cathy-gauthier/modePrompts';
import type { Message } from '../models/Message';
import type { UserProfile } from '../models/UserProfile';

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

const sexLabel: Record<Exclude<UserProfile['sex'], null>, string> = {
  male: 'Homme',
  female: 'Femme',
  non_binary: 'Non-binaire',
  prefer_not_to_say: 'Préfère ne pas répondre'
};

const statusLabel: Record<Exclude<UserProfile['relationshipStatus'], null>, string> = {
  single: 'Célibataire',
  in_relationship: 'En couple',
  married: 'Marié(e)',
  complicated: "C'est compliqué",
  prefer_not_to_say: 'Préfère ne pas répondre'
};

const sexLabelEn: Record<Exclude<UserProfile['sex'], null>, string> = {
  male: 'Male',
  female: 'Female',
  non_binary: 'Non-binary',
  prefer_not_to_say: 'Prefer not to say'
};

const statusLabelEn: Record<Exclude<UserProfile['relationshipStatus'], null>, string> = {
  single: 'Single',
  in_relationship: 'In a relationship',
  married: 'Married',
  complicated: "It's complicated",
  prefer_not_to_say: 'Prefer not to say'
};

function resolvePromptLanguage(language: string | undefined): 'fr' | 'en' {
  if (typeof language === 'string' && language.toLowerCase().startsWith('en')) {
    return 'en';
  }

  return 'fr';
}

function buildUserProfileSection(profile: UserProfile | null | undefined, language: 'fr' | 'en'): string {
  if (!profile) {
    return '';
  }

  const lines: string[] = [];
  const localizedSexLabel = language === 'en' ? sexLabelEn : sexLabel;
  const localizedStatusLabel = language === 'en' ? statusLabelEn : statusLabel;

  if (typeof profile.age === 'number') {
    lines.push(language === 'en' ? `- Approximate age: ${profile.age}` : `- Âge approximatif : ${profile.age} ans`);
  }

  if (profile.sex) {
    lines.push(language === 'en' ? `- Gender: ${localizedSexLabel[profile.sex]}` : `- Genre : ${localizedSexLabel[profile.sex]}`);
  }

  if (profile.relationshipStatus) {
    lines.push(
      language === 'en'
        ? `- Relationship status: ${localizedStatusLabel[profile.relationshipStatus]}`
        : `- Statut : ${localizedStatusLabel[profile.relationshipStatus]}`
    );
  }

  if (profile.horoscopeSign) {
    lines.push(language === 'en' ? `- Horoscope sign: ${profile.horoscopeSign}` : `- Signe astro : ${profile.horoscopeSign}`);
  }

  if (profile.interests.length > 0) {
    lines.push(language === 'en' ? `- Interests: ${profile.interests.join(', ')}` : `- Intérêts : ${profile.interests.join(', ')}`);
  }

  if (lines.length === 0) {
    return '';
  }

  if (language === 'en') {
    return `\n## USER PROFILE\nAdapt your humor and references to this profile:\n${lines.join('\n')}`;
  }

  return `\n## PROFIL UTILISATEUR\nAdapte ton humour et tes références à ce profil :\n${lines.join('\n')}`;
}

export function buildSystemPrompt(modeId: string, userProfile?: UserProfile | null, language?: string): string {
  const b = cathyBlueprint;
  const modePrompt = getModePrompt(modeId);
  const promptLanguage = resolvePromptLanguage(language);
  const userProfileSection = buildUserProfileSection(userProfile, promptLanguage);

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
${userProfileSection}
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
