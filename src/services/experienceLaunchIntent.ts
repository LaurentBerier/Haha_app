import type { LaunchableExperienceDefinition } from '../config/experienceCatalog';

export type ExperienceLaunchReason = 'direct_command' | 'game_play_request' | 'mode_request';

export interface ExperienceLaunchIntentResult {
  experience: LaunchableExperienceDefinition;
  reason: ExperienceLaunchReason;
  matchedAlias: string;
}

const DIRECT_COMMAND_PATTERN =
  /\b(?:lance|ouvre|active|demarre|start|launch|open|switch|go to|take me to|bring me to|amene|emmene)\b/i;
const PLAY_REQUEST_PATTERN = /\b(?:joue|jouons|jouer|play|lets play|let s play|i want to play|je veux jouer)\b/i;
const DESIRE_PATTERN = /\b(?:je veux|j aimerais|j voudrais|i want|can we|on peut|fais moi|show me)\b/i;
const MODE_GAME_WORD_PATTERN = /\b(?:mode|jeu|game)\b/i;

function normalizeForSearch(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findAliasMatch(normalizedText: string, aliases: string[]): string | null {
  for (const alias of aliases) {
    const normalizedAlias = normalizeForSearch(alias);
    if (!normalizedAlias) {
      continue;
    }

    const aliasPattern = new RegExp(`(?:^|\\s)${escapeRegExp(normalizedAlias).replace(/\s+/g, '\\s+')}(?:$|\\s)`, 'i');
    if (aliasPattern.test(normalizedText)) {
      return alias;
    }
  }

  return null;
}

export function resolveExperienceLaunchIntent(
  text: string,
  experiences: LaunchableExperienceDefinition[]
): ExperienceLaunchIntentResult | null {
  const normalizedText = normalizeForSearch(text);
  if (!normalizedText || experiences.length === 0) {
    return null;
  }

  const matches = experiences
    .map((experience) => ({
      experience,
      alias: findAliasMatch(normalizedText, experiencesForLookup(experience))
    }))
    .filter((entry): entry is { experience: LaunchableExperienceDefinition; alias: string } => Boolean(entry.alias));

  if (matches.length !== 1) {
    return null;
  }

  const match = matches[0];
  if (!match) {
    return null;
  }

  const hasDirectCommand = DIRECT_COMMAND_PATTERN.test(normalizedText);
  const hasPlayRequest = PLAY_REQUEST_PATTERN.test(normalizedText);
  const hasDesire = DESIRE_PATTERN.test(normalizedText);
  const hasModeOrGameWord = MODE_GAME_WORD_PATTERN.test(normalizedText);

  if (hasDirectCommand) {
    return {
      experience: match.experience,
      reason: 'direct_command',
      matchedAlias: match.alias
    };
  }

  if (match.experience.type === 'game' && hasPlayRequest) {
    return {
      experience: match.experience,
      reason: 'game_play_request',
      matchedAlias: match.alias
    };
  }

  if (match.experience.type === 'mode' && hasDesire && hasModeOrGameWord) {
    return {
      experience: match.experience,
      reason: 'mode_request',
      matchedAlias: match.alias
    };
  }

  return null;
}

function experiencesForLookup(experience: LaunchableExperienceDefinition): string[] {
  return [experience.nameFr, experience.nameEn, ...experience.aliases].slice(0, 16);
}
