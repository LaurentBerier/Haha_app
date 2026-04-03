import fs from 'node:fs';
import path from 'node:path';

describe('mode-select primary header rendering', () => {
  it('does not render thread mode header on the mode-select home conversation', () => {
    const screenPath = path.resolve(__dirname, '../app/mode-select/[artistId]/index.tsx');
    const screenSource = fs.readFileSync(screenPath, 'utf8');

    expect(screenSource).not.toContain('<ThreadModeHeader');
    expect(screenSource).not.toContain("testID=\"mode-select-thread-mode-header\"");
  });

  it('does not render the new discussion button in mode-select', () => {
    const screenPath = path.resolve(__dirname, '../app/mode-select/[artistId]/index.tsx');
    const screenSource = fs.readFileSync(screenPath, 'utf8');

    expect(screenSource).not.toContain("testID=\"mode-select-new-discussion-button\"");
  });
});
