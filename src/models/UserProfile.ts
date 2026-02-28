export type Sex = 'male' | 'female' | 'non_binary' | 'prefer_not_to_say';

export type RelationshipStatus =
  | 'single'
  | 'in_relationship'
  | 'married'
  | 'complicated'
  | 'prefer_not_to_say';

export type HoroscopeSign =
  | 'aries'
  | 'taurus'
  | 'gemini'
  | 'cancer'
  | 'leo'
  | 'virgo'
  | 'libra'
  | 'scorpio'
  | 'sagittarius'
  | 'capricorn'
  | 'aquarius'
  | 'pisces';

export interface UserProfile {
  id: string;
  age: number | null;
  sex: Sex | null;
  relationshipStatus: RelationshipStatus | null;
  horoscopeSign: HoroscopeSign | null;
  interests: string[];
  onboardingCompleted: boolean;
  onboardingSkipped: boolean;
}
