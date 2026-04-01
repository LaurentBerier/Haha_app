import fs from 'node:fs';
import path from 'node:path';

const ISOLATED_GAME_MODULES = [
  '../app/games/[artistId]/impro-chain.tsx',
  '../app/games/[artistId]/tarot-cathy.tsx',
  '../app/games/[artistId]/vrai-ou-invente.tsx',
  '../games/hooks/useGameLaunchGreeting.ts',
  '../games/hooks/useImproChain.ts',
  '../games/hooks/useTarotCathy.ts',
  '../games/hooks/useVraiOuInvente.ts'
] as const;

const CHAT_STORE_PATTERNS = [
  'state.addMessage',
  'state.updateMessage',
  'state.messagesByConversation',
  'state.createConversation',
  'state.setActiveConversation',
  'state.updateConversation'
] as const;

describe('game chat isolation guards', () => {
  it('does not wire game flows to chat message/conversation store slices', () => {
    ISOLATED_GAME_MODULES.forEach((relativePath) => {
      const absolutePath = path.resolve(__dirname, relativePath);
      const source = fs.readFileSync(absolutePath, 'utf8');

      CHAT_STORE_PATTERNS.forEach((pattern) => {
        expect(source).not.toContain(pattern);
      });
    });
  });
});
