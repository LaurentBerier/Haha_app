import fs from 'node:fs';
import path from 'node:path';

describe('history new discussion button', () => {
  it('keeps the new discussion button in history with translated label key', () => {
    const screenPath = path.resolve(__dirname, '../app/history/[artistId].tsx');
    const screenSource = fs.readFileSync(screenPath, 'utf8');

    expect(screenSource).toContain("testID=\"history-new-discussion-button\"");
    expect(screenSource).toContain("accessibilityLabel={t('newDiscussionCta')}");
    expect(screenSource).toContain("<Text style={styles.newDiscussionButtonText}>{t('newDiscussionCta')}</Text>");
  });
});
