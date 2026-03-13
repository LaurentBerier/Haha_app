import { MODE_IDS } from '../config/constants';
import { resolveModeIdCompat } from '../config/modeCompat';
import type { UserProfile } from '../models/UserProfile';
import { getDailyTopic } from './dailyTopicService';

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
      return `${namePrefix}on jase libre. Balance-moi ce que t'as sur le coeur et je m'ajuste au vibe.`;
    case MODE_IDS.GRILL:
      return `${namePrefix}mode grill active. Tu m'as demande le feu, je vais pas te flatter.`;
    case MODE_IDS.ROAST_BATTLE:
      return `${namePrefix}bataille de roast commence. Tu lances, je replique, puis je donne le verdict final.`;
    case MODE_IDS.MEME_GENERATOR:
      return `${namePrefix}envoie une image et je te propose des captions qui font rire en une seconde.`;
    case MODE_IDS.SCREENSHOT_ANALYZER:
      return `${namePrefix}envoie ton screenshot. Je decode le sous-texte et je te donne la meilleure reponse.`;
    case MODE_IDS.VICTIME_DU_JOUR: {
      const topic = getDailyTopic();
      return `${namePrefix}victime du jour: ${topic}. Sers-moi ta meilleure punchline et on la muscle ensemble.`;
    }
    case MODE_IDS.PHRASE_DU_JOUR:
      return `${namePrefix}pret pour ta phrase du jour? Dis-moi le mood, je te livre une ligne qui marque.`;
    case MODE_IDS.COACH_DE_VIE:
      return `${namePrefix}tu veux du vrai, pas du vernis? Dis-moi la situation et on la regle cash.`;
    default:
      return `${namePrefix}on y va. Raconte-moi ce qui se passe et je te reponds direct.`;
  }
}
