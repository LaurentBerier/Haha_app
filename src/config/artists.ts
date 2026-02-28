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
      'roast',
      'coach-de-vie',
      'phrase-du-jour',
      'message-personnalise',
      'numero-de-show',
      'horoscope',
      'meteo'
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
  }
];
