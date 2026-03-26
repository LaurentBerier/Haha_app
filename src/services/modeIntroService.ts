import { MODE_IDS } from '../config/constants';
import { resolveModeIdCompat } from '../config/modeCompat';
import type { UserProfile } from '../models/UserProfile';

function getPreferredName(profile: UserProfile | null | undefined): string | null {
  if (!profile?.preferredName || typeof profile.preferredName !== 'string') {
    return null;
  }

  const trimmed = profile.preferredName.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function generateModeIntro(modeId: string, userProfile?: UserProfile | null): string {
  const canonicalModeId = resolveModeIdCompat(modeId);
  const preferredName = getPreferredName(userProfile);
  const namePrefix = preferredName ? `${preferredName}, ` : '';

  switch (canonicalModeId) {
    case MODE_IDS.ON_JASE:
      return `${namePrefix}mode Dis-moi la vérité activé. Tu veux du vrai, je te donne du vrai, sans flafla ni excuse.`;
    case MODE_IDS.GRILL:
      return `${namePrefix}mode grill activé. Tu m'as demandé le feu, je vais pas te flatter.`;
    case MODE_IDS.ROAST_BATTLE:
      return `${namePrefix}bataille de roast commence. Tu lances, je réplique, puis je donne le verdict final.`;
    case MODE_IDS.MEME_GENERATOR:
      return `${namePrefix}envoie une image et je te propose des captions qui font rire en une seconde.`;
    case MODE_IDS.SCREENSHOT_ANALYZER:
      return `${namePrefix}envoie ton screenshot ou colle le texto. Je juge l'histoire, puis je te donne une réplique utile.`;
    case MODE_IDS.COACH_DE_VIE:
      return `${namePrefix}tu veux du vrai, pas du vernis? Dis-moi la situation et on la règle cash.`;
    default:
      return `${namePrefix}on y va. Raconte-moi ce qui se passe et je te réponds direct.`;
  }
}
