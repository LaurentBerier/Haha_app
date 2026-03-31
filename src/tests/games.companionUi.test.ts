import fs from 'node:fs';
import path from 'node:path';

describe('game companion chat integration', () => {
  it('wires tarot active screen with integrated composer + message list and dynamic layout helper', () => {
    const filePath = path.resolve(__dirname, '../app/games/[artistId]/tarot-cathy.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('useGameCompanionChat');
    expect(source).toContain('resolveGameChatWindowLayout');
    expect(source).toContain('testID="tarot-companion-message-list"');
    expect(source).toContain('testID="tarot-game-composer"');
    expect(source).toContain('allowImage={false}');
    expect(source).not.toContain("pathname: '/chat/[conversationId]'");
    expect(source).not.toContain("router.push('/chat/");
  });

  it('wires vrai-ou-invente active screen with integrated composer + message list and dynamic layout helper', () => {
    const filePath = path.resolve(__dirname, '../app/games/[artistId]/vrai-ou-invente.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('useGameCompanionChat');
    expect(source).toContain('resolveGameChatWindowLayout');
    expect(source).toContain('testID="vrai-companion-message-list"');
    expect(source).toContain('testID="vrai-game-composer"');
    expect(source).toContain('allowImage={false}');
    expect(source).not.toContain("pathname: '/chat/[conversationId]'");
    expect(source).not.toContain("router.push('/chat/");
  });
});
