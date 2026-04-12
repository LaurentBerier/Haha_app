import fs from 'node:fs';
import path from 'node:path';

describe('mode and sub-mode headers', () => {
  it('uses shared chip header in category mode screen and no native title injection', () => {
    const filePath = path.resolve(__dirname, '../app/mode-select/[artistId]/[categoryId].tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('ModeTopChipHeader');
    expect(source).toContain('chipTestID="mode-category-chip"');
    expect(source).not.toContain('navigation.setOptions');
    expect(source).not.toContain('topRowLeLabWrap');
  });

  it('uses shared chip header in chat screen and removes thread title block', () => {
    const filePath = path.resolve(__dirname, '../app/chat/[conversationId].tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('ModeTopChipHeader');
    expect(source).toContain('chipTestID="chat-mode-chip"');
    expect(source).not.toContain('ThreadModeHeader');
    expect(source).not.toContain('navigation.setOptions');
  });

  it('uses shared chip header on games list and removes duplicate title block', () => {
    const filePath = path.resolve(__dirname, '../app/games/[artistId]/index.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('ModeTopChipHeader');
    expect(source).toContain('chipTestID="games-mode-chip"');
    expect(source).not.toContain("<Text style={styles.title}>{t('gameSelectTitle')}</Text>");
    expect(source).not.toContain("<Text style={styles.subtitle}>{t('gamesSectionSubtitle')}</Text>");
  });

  it('uses shared chip header on each game screen and removes duplicate big title block', () => {
    const improSource = fs.readFileSync(path.resolve(__dirname, '../app/games/[artistId]/impro-chain.tsx'), 'utf8');
    const vraiSource = fs.readFileSync(path.resolve(__dirname, '../app/games/[artistId]/vrai-ou-invente.tsx'), 'utf8');
    const tarotSource = fs.readFileSync(path.resolve(__dirname, '../app/games/[artistId]/tarot-cathy.tsx'), 'utf8');

    expect(improSource).toContain('ModeTopChipHeader');
    expect(improSource).toContain('chipTestID="impro-mode-chip"');
    expect(improSource).not.toContain("<Text style={styles.title}>{t('gameImproTitle')}</Text>");
    expect(improSource).not.toContain("<Text style={styles.subtitle}>{t('gameImproDescription')}</Text>");

    expect(vraiSource).toContain('ModeTopChipHeader');
    expect(vraiSource).toContain('chipTestID="vrai-mode-chip"');
    expect(vraiSource).not.toContain("<Text style={styles.title}>{t('gameVraiInventeTitle')}</Text>");
    expect(vraiSource).not.toContain("<Text style={styles.subtitle}>{t('gameVraiInventeDescription')}</Text>");

    expect(tarotSource).toContain('ModeTopChipHeader');
    expect(tarotSource).toContain('chipTestID="tarot-mode-chip"');
    expect(tarotSource).not.toContain("<Text style={styles.title}>{t('gameTarotTitle')}</Text>");
    expect(tarotSource).not.toContain("<Text style={styles.subtitle}>{t('gameTarotDescription')}</Text>");
  });
});
