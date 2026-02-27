export interface FewShotExample {
  input: string;
  response: string;
  context?: string;
  variables?: string;
}

export interface Mode {
  id: string;
  name: string;
  description: string;
  emoji?: string;
  kind?: 'chat' | 'history';
}

export interface ArtistModeData {
  modeId: string;
  examples: FewShotExample[];
}
