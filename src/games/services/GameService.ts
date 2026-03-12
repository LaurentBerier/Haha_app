import { streamClaudeResponse, type ClaudeMessage } from '../../services/claudeApiService';
import type { UserProfile } from '../../models/UserProfile';
import type { ImproTurn } from '../types';

interface RunImproTurnParams {
  artistId: string;
  history: ImproTurn[];
  language: string;
  userProfile?: UserProfile | null;
  theme?: string | null;
  targetUserTurns?: 3 | 4;
  userTurnCount?: number;
  onToken: (token: string) => void;
  onComplete: (content: string, isEnding: boolean) => void;
  onError: (error: Error) => void;
}

function normalizeText(value: string): string {
  return typeof value === 'string' ? value.trim() : '';
}

export class GameService {
  private static buildImproKickoffPrompt(
    userProfile?: UserProfile | null,
    theme?: string | null,
    targetUserTurns: 3 | 4 = 3
  ): string {
    const hasHoroscope = typeof userProfile?.horoscopeSign === 'string' && Boolean(userProfile.horoscopeSign);
    const lines = [
      "Lance l'histoire avec une premiere phrase absurde.",
      "N'utilise pas toujours l'utilisateur comme sujet principal.",
      'Choisis un angle de depart parmi : reference Quebec/Canada, clin d oeil culture pop locale, actualite marquante, ou detail astro.',
      'Rends l ouverture surprenante et drole, avec une image concrete (lieu, personne, situation).',
      hasHoroscope
        ? `Tu peux faire un clin d oeil au signe astro (${userProfile?.horoscopeSign}) mais sans en faire le seul sujet.`
        : 'Si aucun signe astro n est disponible, privilegie Quebec/Canada et culture locale.',
      `Le jeu doit rester court: conclusion naturelle apres ${targetUserTurns} ou ${targetUserTurns + 1} interventions utilisateur maximum.`
    ];

    const normalizedTheme = normalizeText(theme ?? '');
    if (normalizedTheme) {
      lines.push(`Theme choisi: ${normalizedTheme}`);
    }

    const preferredName = typeof userProfile?.preferredName === 'string' ? userProfile.preferredName.trim() : '';
    if (preferredName) {
      lines.push(`Nom prefere: ${preferredName}`);
    }

    if (typeof userProfile?.age === 'number' && Number.isFinite(userProfile.age)) {
      lines.push(`Age approximatif: ${userProfile.age}`);
    }

    if (Array.isArray(userProfile?.interests) && userProfile.interests.length > 0) {
      lines.push(`Interets: ${userProfile.interests.join(', ')}`);
    }

    if (typeof userProfile?.horoscopeSign === 'string' && userProfile.horoscopeSign) {
      lines.push(`Signe astro: ${userProfile.horoscopeSign}`);
    }

    return lines.join('\n');
  }

  private static buildImproControlPrompt(input: {
    userTurnCount: number;
    targetUserTurns: 3 | 4;
    theme?: string | null;
  }): string {
    const normalizedTheme = normalizeText(input.theme ?? '');
    const shouldConclude = input.userTurnCount >= input.targetUserTurns;

    const lines = [
      'Contexte de partie Impro Chaine:',
      `- Interventions utilisateur: ${input.userTurnCount}/${input.targetUserTurns}`,
      '- Reponse courte: 1 phrase, max 2.',
      normalizedTheme ? `- Theme a respecter: ${normalizedTheme}` : '- Theme libre.'
    ];

    if (shouldConclude) {
      lines.push('- C EST LA DERNIERE REPLIQUE: termine avec une vraie chute et ajoute [FIN] a la fin.');
    } else {
      lines.push('- Continue l histoire, ne mets PAS [FIN] pour l instant.');
    }

    return lines.join('\n');
  }

  static buildImproHistory(
    turns: ImproTurn[],
    options?: {
      userProfile?: UserProfile | null;
      theme?: string | null;
      targetUserTurns?: 3 | 4;
      userTurnCount?: number;
    }
  ): ClaudeMessage[] {
    const targetUserTurns = options?.targetUserTurns === 4 ? 4 : 3;
    const userTurnCount = typeof options?.userTurnCount === 'number' ? Math.max(0, options.userTurnCount) : 0;
    const theme = normalizeText(options?.theme ?? '');
    const history = turns
      .map((turn) => ({
        role: turn.role === 'artist' ? 'assistant' : 'user',
        content: normalizeText(turn.content)
      }))
      .filter((message) => Boolean(message.content)) as ClaudeMessage[];

    const controlMessage: ClaudeMessage = {
      role: 'user',
      content: GameService.buildImproControlPrompt({
        userTurnCount,
        targetUserTurns,
        theme
      })
    };

    if (history.length > 0) {
      return [controlMessage, ...history];
    }

    return [
      {
        role: 'user',
        content: GameService.buildImproKickoffPrompt(options?.userProfile, theme, targetUserTurns)
      },
      controlMessage
    ];
  }

  static extractFin(content: string): { clean: string; isEnding: boolean } {
    const normalized = typeof content === 'string' ? content : '';
    const markerIndex = normalized.indexOf('[FIN]');
    if (markerIndex < 0) {
      return { clean: normalized.trim(), isEnding: false };
    }

    const before = normalized.slice(0, markerIndex).trim();
    const after = normalized.slice(markerIndex + 5).trim();
    const clean = `${before}${before && after ? ' ' : ''}${after}`.trim();
    return { clean, isEnding: true };
  }

  static async runImproTurn(params: RunImproTurnParams): Promise<() => void> {
    let streamedText = '';
    const targetUserTurns = params.targetUserTurns === 4 ? 4 : 3;
    const userTurnCount = typeof params.userTurnCount === 'number' ? Math.max(0, params.userTurnCount) : 0;
    const shouldConcludeNow = userTurnCount >= targetUserTurns;
    const messages = GameService.buildImproHistory(params.history, {
      userProfile: params.userProfile,
      theme: params.theme,
      targetUserTurns,
      userTurnCount
    }).slice(-32);

    const cancel = streamClaudeResponse({
      artistId: params.artistId,
      modeId: 'impro-chain',
      language: params.language,
      messages,
      onToken: (token) => {
        streamedText += token;
        params.onToken(token);
      },
      onComplete: () => {
        const parsed = GameService.extractFin(streamedText);
        params.onComplete(parsed.clean, parsed.isEnding || shouldConcludeNow);
      },
      onError: params.onError
    });

    return cancel;
  }
}
