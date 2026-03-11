import type { RoastRound } from '../types';
import { streamClaudeResponse, type ClaudeMessage } from '../../services/claudeApiService';

interface RunArtistTurnParams {
  artistId: string;
  roundNumber: number;
  totalRounds: number;
  userRoast: string;
  userTotalScore: number;
  artistTotalScore: number;
  conversationHistory: RoastRound[];
  language: string;
  onToken: (token: string) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
}

function normalizeRoundText(value: string): string {
  return typeof value === 'string' ? value.trim() : '';
}

export class GameService {
  static buildGameHistory(completedRounds: RoastRound[]): ClaudeMessage[] {
    const rounds = completedRounds
      .filter((round) => normalizeRoundText(round.userRoast) && normalizeRoundText(round.artistRoast))
      .slice(-6);

    const history: ClaudeMessage[] = [];
    rounds.forEach((round) => {
      history.push({
        role: 'user',
        content: `Round ${round.roundNumber} - Mon roast: ${normalizeRoundText(round.userRoast)}`
      });
      history.push({
        role: 'assistant',
        content: `Round ${round.roundNumber} - Contre-attaque: ${normalizeRoundText(round.artistRoast)}`
      });
    });

    return history;
  }

  static async runArtistTurn(params: RunArtistTurnParams): Promise<() => void> {
    const history = GameService.buildGameHistory(params.conversationHistory);
    const roundPrompt = `[Round ${params.roundNumber}/${params.totalRounds} | Toi: ${params.userTotalScore} pts - Adversaire: ${params.artistTotalScore} pts]
Roast recu: "${normalizeRoundText(params.userRoast)}"`;

    const cancel = streamClaudeResponse({
      artistId: params.artistId,
      modeId: 'roast-duel-game',
      language: params.language,
      messages: [
        ...history,
        {
          role: 'user',
          content: roundPrompt
        }
      ],
      onToken: params.onToken,
      onComplete: () => params.onComplete(),
      onError: params.onError
    });

    return cancel;
  }
}
