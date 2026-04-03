import fs from 'node:fs';
import path from 'node:path';

describe('history new discussion button', () => {
  it('keeps per-artist new discussion buttons in global history with translated label key', () => {
    const screenPath = path.resolve(__dirname, '../app/history/index.tsx');
    const screenSource = fs.readFileSync(screenPath, 'utf8');

    expect(screenSource).toContain('testID={`history-artist-section-${group.artist.id}`}');
    expect(screenSource).toContain('testID={`history-new-discussion-button-${group.artist.id}`}');
    expect(screenSource).toContain("accessibilityLabel={t('newDiscussionCta')}");
    expect(screenSource).toContain("<Text style={styles.newDiscussionButtonText}>{t('newDiscussionCta')}</Text>");
    expect(screenSource).toContain('const nextConversation = createAndPromotePrimaryConversation(artistId, language);');
    expect(screenSource).toContain('router.push(`/mode-select/${artistId}`);');
    expect(screenSource).not.toContain('router.push(`/chat/${nextConversation.id}`);');
  });

  it('routes primary threads to artist hub and keeps mode threads in chat route', () => {
    const screenPath = path.resolve(__dirname, '../app/history/index.tsx');
    const screenSource = fs.readFileSync(screenPath, 'utf8');

    expect(screenSource).toContain("if (threadType === 'primary') {");
    expect(screenSource).toContain('router.push(`/mode-select/${conversation.artistId}`);');
    expect(screenSource).toContain('router.push(`/chat/${conversation.id}`);');
    expect(screenSource).toContain("setModeSelectSessionHubConversation(conversation.artistId, conversation.id);");
    expect(screenSource).toContain("setModeSelectSessionHubConversation(artistId, nextConversation.id);");
  });

  it('renders dedicated titles for primary and archived secondary threads', () => {
    const screenPath = path.resolve(__dirname, '../app/history/index.tsx');
    const screenSource = fs.readFileSync(screenPath, 'utf8');

    expect(screenSource).toContain("threadType === 'primary'");
    expect(screenSource).toContain("t('primaryThreadTitle')");
    expect(screenSource).toContain("t('historyArchivedThreadTitle')");
    expect(screenSource).toContain('resolveArchivedThreadTitle(conversation.updatedAt)');
    expect(screenSource).toContain('formatShortDate(updatedAt)');
  });
});
