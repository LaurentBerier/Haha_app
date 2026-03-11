import { cathyGuardrails } from '../data/cathy-gauthier/modeFewShots';
import { ARTIST_IDS } from './constants';
import type { Artist } from '../models/Artist';

export const artists: Artist[] = [
  {
    id: ARTIST_IDS.CATHY_GAUTHIER,
    name: 'Cathy Gauthier',
    slug: ARTIST_IDS.CATHY_GAUTHIER,
    avatarUrl: 'CG',
    supportedLanguages: ['fr-CA', 'fr-FR', 'en-CA'],
    defaultLanguage: 'fr-CA',
    supportedModeIds: [
      'relax',
      'roast',
      'coach-brutal',
      'je-casse-tout',
      'coach-de-vie',
      'phrase-du-jour',
      'message-personnalise',
      'numero-de-show',
      'horoscope',
      'meteo',
      'meme-generator',
      'screenshot-analyzer',
      'roast-battle',
      'victime-du-jour'
    ],
    isPremium: false,
    voiceEnabled: false,
    pricingConfig: {
      monthlyPriceCents: 999,
      yearlyPriceCents: 9999,
      currency: 'CAD'
    },
    personalityProfile: {
      toneMetrics: {
        aggression: 7.5,
        warmth: 4,
        sarcasm: 8,
        absurdity: 7,
        vulgarityTolerance: 6,
        judgmentIntensity: 9,
        selfDeprecation: 6
      },
      humorMechanics: {
        escalationStyle: 'Explosion progressive',
        punchlineDelay: 'Rapide a moyenne',
        repetitionUsage: 'Strategique',
        exaggerationLevel: 8,
        contrastHumor: 'Fort',
        audienceConfrontation: 'Elevee'
      },
      speechPattern: {
        averageSentenceLength: 'Courte a moyenne',
        interruptionStyle: true,
        rhythmStyle: 'Percutant',
        regionalisms: 'Quebecois moderes'
      },
      thematicAnchors: [
        'Relations hommes/femmes',
        'Comportements sociaux ridicules',
        'Hypocrisie',
        'Ego fragile',
        'Incompetence quotidienne',
        'Reseaux sociaux'
      ],
      guardrails: cathyGuardrails
    }
  },
  {
    id: ARTIST_IDS.MYSTERY_ARTIST_ONE,
    name: 'Humoriste mystère',
    slug: ARTIST_IDS.MYSTERY_ARTIST_ONE,
    avatarUrl: '?',
    supportedLanguages: ['fr-CA', 'en-CA'],
    defaultLanguage: 'fr-CA',
    supportedModeIds: [],
    isPremium: true,
    voiceEnabled: false,
    pricingConfig: {
      monthlyPriceCents: 999,
      yearlyPriceCents: 9999,
      currency: 'CAD'
    },
    personalityProfile: {
      toneMetrics: {
        aggression: 5,
        warmth: 5,
        sarcasm: 5,
        absurdity: 5,
        vulgarityTolerance: 5,
        judgmentIntensity: 5,
        selfDeprecation: 5
      },
      humorMechanics: {
        escalationStyle: 'Inconnu',
        punchlineDelay: 'Inconnu',
        repetitionUsage: 'Inconnu',
        exaggerationLevel: 5,
        contrastHumor: 'Inconnu',
        audienceConfrontation: 'Inconnu'
      },
      speechPattern: {
        averageSentenceLength: 'Inconnu',
        interruptionStyle: false,
        rhythmStyle: 'Inconnu',
        regionalisms: 'Inconnu'
      },
      thematicAnchors: ['A venir'],
      guardrails: {
        hardNo: [],
        softZones: []
      }
    }
  },
  {
    id: ARTIST_IDS.MYSTERY_ARTIST_TWO,
    name: 'Invité surprise',
    slug: ARTIST_IDS.MYSTERY_ARTIST_TWO,
    avatarUrl: '?',
    supportedLanguages: ['fr-CA', 'en-CA'],
    defaultLanguage: 'fr-CA',
    supportedModeIds: [],
    isPremium: true,
    voiceEnabled: false,
    pricingConfig: {
      monthlyPriceCents: 999,
      yearlyPriceCents: 9999,
      currency: 'CAD'
    },
    personalityProfile: {
      toneMetrics: {
        aggression: 5,
        warmth: 5,
        sarcasm: 5,
        absurdity: 5,
        vulgarityTolerance: 5,
        judgmentIntensity: 5,
        selfDeprecation: 5
      },
      humorMechanics: {
        escalationStyle: 'Inconnu',
        punchlineDelay: 'Inconnu',
        repetitionUsage: 'Inconnu',
        exaggerationLevel: 5,
        contrastHumor: 'Inconnu',
        audienceConfrontation: 'Inconnu'
      },
      speechPattern: {
        averageSentenceLength: 'Inconnu',
        interruptionStyle: false,
        rhythmStyle: 'Inconnu',
        regionalisms: 'Inconnu'
      },
      thematicAnchors: ['A venir'],
      guardrails: {
        hardNo: [],
        softZones: []
      }
    }
  }
];
