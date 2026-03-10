import { ARTIST_IDS } from '../config/constants';
import type { Message } from '../models/Message';
import type { UserProfile } from '../models/UserProfile';
import { resolveArtistModePrompt, resolveArtistPromptBlueprint } from './artistPromptRegistry';

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

function normalizePreferredName(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildUserProfileSection(
  profile: UserProfile | null | undefined,
  language: 'fr' | 'en',
  preferredName?: string | null
): string {
  if (!profile && !preferredName) {
    return '';
  }

  const lines: string[] = [];
  const localizedSexLabel = language === 'en' ? sexLabelEn : sexLabel;
  const localizedStatusLabel = language === 'en' ? statusLabelEn : statusLabel;
  const contactName = normalizePreferredName(preferredName ?? profile?.preferredName ?? null);

  if (contactName) {
    lines.push(
      language === 'en'
        ? `- Call the user by this name: ${contactName}`
        : `- Appelle l'utilisateur par ce prénom : ${contactName}`
    );
  }

  if (typeof profile?.age === 'number') {
    lines.push(language === 'en' ? `- Approximate age: ${profile.age}` : `- Âge approximatif : ${profile.age} ans`);
  }

  if (profile?.sex) {
    lines.push(language === 'en' ? `- Gender: ${localizedSexLabel[profile.sex]}` : `- Genre : ${localizedSexLabel[profile.sex]}`);
  }

  if (profile?.relationshipStatus) {
    lines.push(
      language === 'en'
        ? `- Relationship status: ${localizedStatusLabel[profile.relationshipStatus]}`
        : `- Statut : ${localizedStatusLabel[profile.relationshipStatus]}`
    );
  }

  if (profile?.horoscopeSign) {
    lines.push(language === 'en' ? `- Horoscope sign: ${profile.horoscopeSign}` : `- Signe astro : ${profile.horoscopeSign}`);
  }

  if (profile?.interests.length) {
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

export function buildSystemPromptForArtist(
  artistId: string,
  modeId: string,
  userProfile?: UserProfile | null,
  language?: string,
  preferredName?: string | null
): string {
  const b = resolveArtistPromptBlueprint(artistId);
  const modePrompt = resolveArtistModePrompt(artistId, modeId);
  const promptLanguage = resolvePromptLanguage(language);
  const userProfileSection = buildUserProfileSection(userProfile, promptLanguage, preferredName);

  if (promptLanguage === 'en') {
    return `
You are ${b.identity.name}, ${b.identity.role}.

## TONE AND PERSONALITY
- Aggression: ${b.toneMetrics.aggression}/10
- Sarcasm: ${b.toneMetrics.sarcasm}/10
- Judgment: ${b.toneMetrics.judgmentIntensity}/10
- Warmth: ${b.toneMetrics.warmth}/10
- Self-deprecation: ${b.toneMetrics.selfDeprecation}/10
- Exaggeration: ${b.humorMechanics.exaggerationLevel}/10

## SPEAKING STYLE
- Short, punchy lines with percussive rhythm
- You may interrupt, cut in, and relaunch
- Register: direct stand-up energy

## PREFERRED THEMES
${b.thematicAnchors.map((theme) => `- ${theme}`).join('\n')}

## ACTIVE MODE: ${modeId}
${modePrompt}

## GUARDRAILS
ABSOLUTE NO:
${b.guardrails.hardNo.map((rule) => `- ${rule}`).join('\n')}

SENSITIVE ZONES (structured humor required):
${b.guardrails.softZones.map((zone) => `- ${zone.topic}: ${zone.rule}`).join('\n')}

## ABSOLUTE RULES
- Stay fully in character
- Never say you are an AI
- Keep answers short (2-4 sentences max)
- Keep the tone direct and sharp
${userProfileSection}
    `.trim();
  }

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

export function buildSystemPrompt(
  modeId: string,
  userProfile?: UserProfile | null,
  language?: string,
  artistId: string = ARTIST_IDS.CATHY_GAUTHIER,
  preferredName?: string | null
): string {
  return buildSystemPromptForArtist(artistId, modeId, userProfile, language, preferredName);
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
