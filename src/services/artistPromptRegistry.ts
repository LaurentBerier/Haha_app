import { artists } from '../config/artists';
import { ARTIST_IDS } from '../config/constants';
import { cathyBlueprint } from '../data/cathy-gauthier/personalityBlueprint';
import { getModePrompt as getCathyModePrompt } from '../data/cathy-gauthier/modePrompts';

export interface PromptBlueprint {
  identity: {
    name: string;
    role: string;
  };
  toneMetrics: {
    aggression: number;
    warmth: number;
    sarcasm: number;
    judgmentIntensity: number;
    selfDeprecation: number;
  };
  humorMechanics: {
    exaggerationLevel: number;
  };
  thematicAnchors: string[];
  guardrails: {
    hardNo: string[];
    softZones: Array<{ topic: string; rule: string }>;
  };
}

const DEFAULT_MODE_PROMPT = `Conversation libre. Reponds selon la personnalite de l'artiste selectionne dans une discussion informelle, avec repartie rapide et humour concret.`;

function toFallbackRole(name: string): string {
  if (name.includes('?')) {
    return 'Humoriste invite mystere';
  }
  return 'Humoriste';
}

function toCatalogBlueprint(artistId: string): PromptBlueprint | null {
  const artist = artists.find((entry) => entry.id === artistId);
  if (!artist) {
    return null;
  }

  return {
    identity: {
      name: artist.name,
      role: toFallbackRole(artist.name)
    },
    toneMetrics: {
      aggression: artist.personalityProfile.toneMetrics.aggression,
      warmth: artist.personalityProfile.toneMetrics.warmth,
      sarcasm: artist.personalityProfile.toneMetrics.sarcasm,
      judgmentIntensity: artist.personalityProfile.toneMetrics.judgmentIntensity,
      selfDeprecation: artist.personalityProfile.toneMetrics.selfDeprecation
    },
    humorMechanics: {
      exaggerationLevel: artist.personalityProfile.humorMechanics.exaggerationLevel
    },
    thematicAnchors: artist.personalityProfile.thematicAnchors,
    guardrails: artist.personalityProfile.guardrails
  };
}

export function resolveArtistPromptBlueprint(artistId: string): PromptBlueprint {
  if (artistId === ARTIST_IDS.CATHY_GAUTHIER) {
    return cathyBlueprint;
  }

  return toCatalogBlueprint(artistId) ?? cathyBlueprint;
}

export function resolveArtistModePrompt(artistId: string, modeId: string): string {
  if (artistId === ARTIST_IDS.CATHY_GAUTHIER) {
    return getCathyModePrompt(modeId);
  }

  return DEFAULT_MODE_PROMPT;
}
