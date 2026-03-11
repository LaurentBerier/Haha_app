import { streamClaudeResponse, type ClaudeMessage } from '../../services/claudeApiService';
import type { ImproTurn } from '../types';

interface RunImproTurnParams {
  artistId: string;
  history: ImproTurn[];
  language: string;
  onToken: (token: string) => void;
  onComplete: (content: string, isEnding: boolean) => void;
  onError: (error: Error) => void;
}

function normalizeText(value: string): string {
  return typeof value === 'string' ? value.trim() : '';
}

export class GameService {
  static buildImproHistory(turns: ImproTurn[]): ClaudeMessage[] {
    const history = turns
      .map((turn) => ({
        role: turn.role === 'artist' ? 'assistant' : 'user',
        content: normalizeText(turn.content)
      }))
      .filter((message) => Boolean(message.content)) as ClaudeMessage[];

    if (history.length > 0) {
      return history;
    }

    return [
      {
        role: 'user',
        content: "Lance l'histoire avec une premiere phrase absurde."
      }
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
    const messages = GameService.buildImproHistory(params.history).slice(-30);

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
        params.onComplete(parsed.clean, parsed.isEnding);
      },
      onError: params.onError
    });

    return cancel;
  }
}

