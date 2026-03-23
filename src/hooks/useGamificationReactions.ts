import { useCallback } from 'react';
import { MODE_IDS } from '../config/constants';
import { resolveModeIdCompat } from '../config/modeCompat';
import type { ScoreAction } from '../models/Gamification';
import type { ImageIntent } from '../services/imageIntentService';

const REACT_TAG_PATTERN = /^\s*\[REACT:([^\]\n]{1,8})\]\s*/i;
const ALLOWED_REACTIONS = new Set(['😂', '💀', '😮', '😤', '🙄', '😬', '🤔', '👍']);

function detectBattleResult(content: string): 'light' | 'solid' | 'destruction' | null {
  const normalized = content.toLowerCase();
  if (normalized.includes('verdict: 💀') || normalized.includes('💀 destruction')) {
    return 'destruction';
  }
  if (normalized.includes('verdict: 🎤') || normalized.includes('🎤 solide')) {
    return 'solid';
  }
  if (normalized.includes('verdict: 🔥') || normalized.includes('🔥 leger')) {
    return 'light';
  }
  return null;
}

function resolveScoreActions(
  modeId: string,
  imageIntent: ImageIntent,
  battleResult: 'light' | 'solid' | 'destruction' | null
): ScoreAction[] {
  const canonicalModeId = resolveModeIdCompat(modeId);
  const actions = new Set<ScoreAction>();

  if (canonicalModeId === MODE_IDS.GRILL) {
    actions.add('roast_generated');
  }

  if (
    modeId === MODE_IDS.PHRASE_DU_JOUR ||
    canonicalModeId === MODE_IDS.ON_JASE ||
    modeId === MODE_IDS.VICTIME_DU_JOUR
  ) {
    actions.add('punchline_created');
  }

  if (modeId === MODE_IDS.VICTIME_DU_JOUR) {
    actions.add('daily_participation');
  }

  if (imageIntent === 'photo-roast') {
    actions.add('photo_roasted');
  }

  if (imageIntent === 'meme-generator') {
    actions.add('meme_generated');
  }

  if (modeId === MODE_IDS.ROAST_BATTLE && battleResult === 'destruction') {
    actions.add('battle_win');
  }

  return [...actions];
}

function extractReactionTag(text: string): { reaction: string | null; cleaned: string } {
  const source = typeof text === 'string' ? text : '';
  const match = source.match(REACT_TAG_PATTERN);
  if (!match) {
    return {
      reaction: null,
      cleaned: source
    };
  }

  const reactionCandidate = typeof match[1] === 'string' ? match[1].trim() : '';
  const reaction = ALLOWED_REACTIONS.has(reactionCandidate) ? reactionCandidate : null;

  return {
    reaction,
    cleaned: source.slice(match[0].length).trimStart()
  };
}

function reactionToScoreAction(reaction: string): ScoreAction | null {
  if (reaction === '😂' || reaction === '💀') {
    return 'joke_landed';
  }
  if (reaction === '😮') {
    return 'cathy_surprised';
  }
  if (reaction === '😤') {
    return 'cathy_triggered';
  }
  if (reaction === '🤔') {
    return 'cathy_intrigued';
  }
  if (reaction === '👍') {
    return 'cathy_approved';
  }
  return null;
}

export function useGamificationReactions() {
  const extractTag = useCallback((content: string) => extractReactionTag(content), []);
  const resolveReactionAction = useCallback((reaction: string) => reactionToScoreAction(reaction), []);
  const detectBattle = useCallback((content: string) => detectBattleResult(content), []);
  const resolveActions = useCallback(
    (modeId: string, imageIntent: ImageIntent, battleResult: 'light' | 'solid' | 'destruction' | null) =>
      resolveScoreActions(modeId, imageIntent, battleResult),
    []
  );

  return {
    detectBattleResult: detectBattle,
    resolveScoreActions: resolveActions,
    extractReactionTag: extractTag,
    reactionToScoreAction: resolveReactionAction
  };
}
