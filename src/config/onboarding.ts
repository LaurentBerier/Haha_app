import type { HoroscopeSign, RelationshipStatus, Sex } from '../models/UserProfile';

export const INTEREST_OPTIONS = [
  'Sport',
  'Musique',
  'Humour',
  'Voyage',
  'Famille',
  'Technologie',
  'Mode',
  'Politique',
  'Cinéma',
  'Séries'
] as const;

export const SEX_OPTIONS: Array<{ label: string; value: Sex }> = [
  { label: 'Homme', value: 'male' },
  { label: 'Femme', value: 'female' },
  { label: 'Non-binaire', value: 'non_binary' },
  { label: 'Préfère ne pas répondre', value: 'prefer_not_to_say' }
];

export const RELATIONSHIP_OPTIONS: Array<{ label: string; value: RelationshipStatus }> = [
  { label: 'Célibataire', value: 'single' },
  { label: 'En couple', value: 'in_relationship' },
  { label: 'Marié(e)', value: 'married' },
  { label: "C'est compliqué", value: 'complicated' },
  { label: 'Préfère ne pas répondre', value: 'prefer_not_to_say' }
];

export const HOROSCOPE_OPTIONS: Array<{ label: string; value: HoroscopeSign }> = [
  { label: 'Bélier', value: 'aries' },
  { label: 'Taureau', value: 'taurus' },
  { label: 'Gémeaux', value: 'gemini' },
  { label: 'Cancer', value: 'cancer' },
  { label: 'Lion', value: 'leo' },
  { label: 'Vierge', value: 'virgo' },
  { label: 'Balance', value: 'libra' },
  { label: 'Scorpion', value: 'scorpio' },
  { label: 'Sagittaire', value: 'sagittarius' },
  { label: 'Capricorne', value: 'capricorn' },
  { label: 'Verseau', value: 'aquarius' },
  { label: 'Poissons', value: 'pisces' }
];
