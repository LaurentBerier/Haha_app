export interface PricingConfig {
  monthlyPriceCents: number;
  yearlyPriceCents: number;
  currency: string;
}

export interface PersonalityProfile {
  toneMetrics: {
    aggression: number;
    warmth: number;
    sarcasm: number;
    absurdity: number;
    vulgarityTolerance: number;
    judgmentIntensity: number;
    selfDeprecation: number;
  };
  humorMechanics: {
    escalationStyle: string;
    punchlineDelay: string;
    repetitionUsage: string;
    exaggerationLevel: number;
    contrastHumor: string;
    audienceConfrontation: string;
  };
  speechPattern: {
    averageSentenceLength: string;
    interruptionStyle: boolean;
    rhythmStyle: string;
    regionalisms: string;
  };
  thematicAnchors: string[];
  guardrails: {
    hardNo: string[];
    softZones: { topic: string; rule: string }[];
  };
}

export interface Artist {
  id: string;
  name: string;
  slug: string;
  avatarUrl: string;
  supportedLanguages: string[];
  defaultLanguage: string;
  supportedModeIds: string[];
  isPremium: boolean;
  voiceEnabled: boolean;
  personalityProfile: PersonalityProfile;
  pricingConfig: PricingConfig;
}
