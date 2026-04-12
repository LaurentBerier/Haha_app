import fs from 'node:fs';
import path from 'node:path';

describe('game launch intro integration', () => {
  it('wires tarot screen with shared launch intro and no integrated game composer', () => {
    const filePath = path.resolve(__dirname, '../app/games/[artistId]/tarot-cathy.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('useGameLaunchGreeting');
    expect(source).toContain('GameLaunchIntro');
    expect(source).toContain('testIDPrefix="tarot"');
    expect(source).toContain('showTitle={false}');
    expect(source).toContain('if (isIntroVisible)');
    expect(source).not.toContain('useGameCompanionChat');
    expect(source).not.toContain('testID="tarot-game-composer"');
    expect(source).not.toContain('MessageList');
    expect(source).not.toContain('ChatInput');
    expect(source).not.toContain("pathname: '/chat/[conversationId]'");
    expect(source).not.toContain("router.push('/chat/");
  });

  it('wires vrai-ou-invente screen with shared launch intro and no integrated game composer', () => {
    const filePath = path.resolve(__dirname, '../app/games/[artistId]/vrai-ou-invente.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('useGameLaunchGreeting');
    expect(source).toContain('GameLaunchIntro');
    expect(source).toContain('testIDPrefix="vrai"');
    expect(source).toContain('showTitle={false}');
    expect(source).toContain('if (isIntroVisible)');
    expect(source).not.toContain('useGameCompanionChat');
    expect(source).not.toContain('testID="vrai-game-composer"');
    expect(source).not.toContain('MessageList');
    expect(source).not.toContain('ChatInput');
    expect(source).not.toContain("pathname: '/chat/[conversationId]'");
    expect(source).not.toContain("router.push('/chat/");
  });

  it('wires impro screen with shared launch intro while keeping impro composer gameplay flow', () => {
    const filePath = path.resolve(__dirname, '../app/games/[artistId]/impro-chain.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('useGameLaunchGreeting');
    expect(source).toContain('GameLaunchIntro');
    expect(source).toContain('testIDPrefix="impro"');
    expect(source).toContain('showTitle={false}');
    expect(source).toContain('if (isIntroVisible)');
    expect(source).toContain('ChatInput');
    expect(source).toContain('testID="impro-message-list"');
    expect(source).not.toContain("pathname: '/chat/[conversationId]'");
    expect(source).not.toContain("router.push('/chat/");
  });
});
