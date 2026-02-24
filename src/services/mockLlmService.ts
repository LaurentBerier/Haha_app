import { MOCK_STREAM_TOKEN_DELAY_MS } from '../config/constants';

interface StreamParams {
  systemPrompt: string;
  userTurn: string;
  language: string;
  onToken: (token: string) => void;
  onComplete: (usage: { tokensUsed: number }) => void;
  onError: (error: Error) => void;
}

function buildMockReply(userTurn: string): string {
  return `Ok, on va se dire les vraies affaires: ${userTurn}. Tu me lances ca comme ca, puis tu veux pas que je reagisse? Evidemment que je reagis. J en mets un peu, je monte, et la, boum, punchline.`;
}

export function streamMockReply(params: StreamParams): () => void {
  const { userTurn, onToken, onComplete, onError } = params;

  try {
    const output = buildMockReply(userTurn);
    const tokens = output.split(' ');
    let index = 0;

    const timer = setInterval(() => {
      if (index >= tokens.length) {
        clearInterval(timer);
        onComplete({ tokensUsed: tokens.length });
        return;
      }

      onToken(`${tokens[index]} `);
      index += 1;
    }, MOCK_STREAM_TOKEN_DELAY_MS);

    return () => clearInterval(timer);
  } catch (error) {
    const normalized =
      error instanceof Error
        ? error
        : new Error(typeof error === 'string' ? error : 'Unknown streaming error');
    onError(normalized);
    return () => undefined;
  }
}
