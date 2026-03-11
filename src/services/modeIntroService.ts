import { MODE_IDS } from '../config/constants';
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
  const preferredName = getPreferredName(userProfile);
  const namePrefix = preferredName ? `${preferredName}, ` : '';

  switch (modeId) {
    case MODE_IDS.RELAX:
      return `${namePrefix}on se calme sans devenir beige: raconte ce qui te gruge et je te sors une ligne utile.`;
    case MODE_IDS.COACH_BRUTAL:
      return `${namePrefix}ici c'est execution, pas excuses. Donne ton objectif et je te le coupe en etapes actionnables.`;
    case MODE_IDS.JE_CASSE_TOUT:
      return `${namePrefix}vide ton sac. Je transforme ton chaos en punchline propre et satisfaisante.`;
    case MODE_IDS.ROAST:
      return `${namePrefix}mode roast active. Donne-moi de la matiere, je cogne avec precision.`;
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
    case MODE_IDS.RADAR_ATTITUDE:
      return `${namePrefix}raconte-moi la scene et je te donne le radar d'attitude sans filtre.`;
    default:
      return `${namePrefix}on y va. Raconte-moi ce qui se passe et je te reponds en mode Cathy.`;
  }
}
