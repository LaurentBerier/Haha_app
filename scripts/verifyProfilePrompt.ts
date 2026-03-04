import assert from 'node:assert/strict';
import { buildSystemPrompt } from '../src/services/personalityEngineService';
import type { UserProfile } from '../src/models/UserProfile';

function assertContains(haystack: string, needle: string): void {
  assert.ok(haystack.includes(needle), `Expected prompt to contain: ${needle}`);
}

function assertNotContains(haystack: string, needle: string): void {
  assert.ok(!haystack.includes(needle), `Expected prompt to NOT contain: ${needle}`);
}

const populatedProfile: UserProfile = {
  id: 'user-1',
  age: 28,
  sex: 'female',
  relationshipStatus: 'single',
  horoscopeSign: 'scorpio',
  interests: ['Humour', 'Musique'],
  onboardingCompleted: true,
  onboardingSkipped: false
};

const promptWithProfile = buildSystemPrompt('radar-attitude', populatedProfile);
assertContains(promptWithProfile, '## PROFIL UTILISATEUR');
assertContains(promptWithProfile, '- Âge approximatif : 28 ans');
assertContains(promptWithProfile, '- Genre : Femme');
assertContains(promptWithProfile, '- Statut : Célibataire');
assertContains(promptWithProfile, '- Signe astro : scorpio');
assertContains(promptWithProfile, '- Intérêts : Humour, Musique');

const emptyProfile: UserProfile = {
  id: 'user-2',
  age: null,
  sex: null,
  relationshipStatus: null,
  horoscopeSign: null,
  interests: [],
  onboardingCompleted: true,
  onboardingSkipped: false
};

const promptWithEmptyProfile = buildSystemPrompt('radar-attitude', emptyProfile);
assertNotContains(promptWithEmptyProfile, '## PROFIL UTILISATEUR');

const promptWithoutProfile = buildSystemPrompt('radar-attitude', null);
assertNotContains(promptWithoutProfile, '## PROFIL UTILISATEUR');

console.log('verify:profile-prompt passed');
