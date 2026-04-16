# Challenge: Optimiser le délai de réponse conversationnelle

## Contexte

HAHA est une app de conversation vocale avec une IA (Cathy). Le flow est:

```
Utilisateur parle → STT (transcription) → API (réponse IA) → TTS (synthèse vocale) → Playback → STT redémarre → ...
```

Sur iOS natif (iPhone), chaque maillon de cette chaîne ajoute de la latence. L'objectif est de rendre la conversation aussi naturelle qu'un échange humain, où le délai entre la fin de la phrase de l'utilisateur et le début de la réponse est minimal (~1-2s perçu).

## État actuel de la latence (2026-04-16)

### Segment 1: Utilisateur finit de parler → envoi au serveur
- **Silence timeout:** 1800ms après le dernier mot détecté par le STT
- C'est le plus gros délai perçu côté utilisateur — il doit attendre 1.8s de silence avant que sa phrase soit envoyée
- Trop court = coupe l'utilisateur mid-phrase. Trop long = conversation lente

### Segment 2: Envoi → début du playback TTS
- Appel API pour la réponse IA: variable (~1-3s selon le modèle et la longueur)
- TTS synthesis (ElevenLabs): variable, streaming chunked
- Premier chunk audio disponible: dépend du temps API + TTS
- `setAudioModeAsync({allowsRecording: false})`: ~200-400ms
- Création du player + premier frame audio: ~100ms

### Segment 3: Fin du TTS → STT redémarre
- `releaseNativeAudio` (restore allowsRecording=true): ~400ms
- React render cycle (isPlaying=false → auto-listen trigger): ~400ms
- Délai recognizer (yield iOS): 50ms
- `configureAudioSessionForRecording`: SKIP si flag (0ms) ou ~400ms sinon
- `module.start()` → `audiostart`: ~1200ms (SFSpeechRecognizer startup natif)
- **Total actuel: ~1.9-2.5s**

## Contraintes techniques

### iOS Audio Session
- iOS ne permet qu'un seul mode audio actif à la fois. Passer de playback (`allowsRecording=false`) à recording (`allowsRecording=true`) nécessite un appel async `setAudioModeAsync` qui prend ~200-400ms
- Le `SFSpeechRecognizer` nécessite ~1200ms entre `start()` et le premier `audiostart` — c'est un délai natif iOS incompressible
- Changer l'audio session pendant un playback tue le son immédiatement

### STT Natif (SFSpeechRecognizer)
- Mode `continuous: true` requis sur iOS — le mode single-utterance meurt sans résultats après un changement d'audio session
- Les erreurs `audio-capture` avec "Audio route changed" sont des faux positifs de permission — elles arrivent quand le haut-parleur se reconfigure après le TTS
- Le recognizer a besoin d'un court délai (~50ms) après cleanup pour éviter des conflits avec la session précédente

### TTS Multi-chunks
- Les réponses longues sont découpées en chunks audio
- L'audio session doit rester en mode playback (`allowsRecording=false`) pendant toute la queue
- Le nettoyage inter-chunks ne doit toucher que le player, pas l'audio session

## Pistes d'optimisation à explorer

### 1. Réduire le silence timeout intelligemment
- Silence timeout adaptatif: plus court après une question directe de Cathy, plus long quand l'utilisateur raconte une histoire
- Détecter les patterns de fin de phrase (intonation descendante via les résultats STT intermédiaires, ponctuation ajoutée par le recognizer)
- Valeur actuelle: 1800ms. Cible possible: 1000-1200ms pour les réponses courtes

### 2. Pré-démarrer le STT pendant le dernier chunk TTS
- Anticiper la fin du playback: quand on joue le dernier chunk de la queue, on pourrait commencer à préparer le STT (pre-load le module, configurer l'audio session dès que le chunk est presque fini)
- Risque: changer l'audio session trop tôt coupe le dernier mot du TTS

### 3. Streaming TTS + début de playback plus tôt
- Commencer le playback dès que le premier chunk TTS est prêt au lieu d'attendre la réponse complète
- Déjà partiellement implémenté via `appendToQueue`, mais le premier chunk attend la première phrase complète de l'API

### 4. Réduire le overhead React
- Le cycle React (state update → re-render → effect trigger) ajoute ~400ms
- Explorer: `useRef` + callback direct au lieu de passer par un state update React pour le signal "playback terminé → démarrer STT"
- Ou: déclencher le startListeningFlow directement depuis `stop()` dans useAudioPlayer via un callback, au lieu de dépendre du re-render React

### 5. Audio session pre-warming
- Appeler `setAudioModeAsync({allowsRecording: true})` en background pendant les dernières secondes du playback TTS, sans couper le son (si iOS le permet)
- Ou: garder l'audio session en mode recording même pendant le playback (nécessite de vérifier si le playback fonctionne avec `allowsRecording: true`)

## Fichiers impliqués

| Fichier | Ce qu'il contrôle |
|---------|-------------------|
| `src/hooks/useAudioPlayer.ts` | Playback TTS, queue, transitions audio session |
| `src/hooks/useVoiceConversation.ts` | State machine voix, silence timeout, auto-listen, recovery |
| `src/services/voiceEngine.ts` | STT natif + web, démarrage/arrêt recognizer |
| `src/services/audioSessionState.ts` | Flag partagé pour skip appels audio session redondants |
| `src/contracts/conversationContracts.ts` | Constantes: silence timeout, recovery delays |

## Métriques à suivre

Utiliser les logs `[STT_DEBUG]` (via `sttDebugLogger.ts` → serveur port 9999 → `/tmp/stt_debug.log`) pour mesurer:
- **T1**: timestamp du `silenceTimeout fired` (utilisateur a fini de parler)
- **T2**: timestamp du premier `playQueue: setting allowsRecording=false` (premier audio TTS prêt)
- **T3**: timestamp du `native 'audiostart' event` après la fin du TTS (mic live à nouveau)
- **Latence perçue** = T2 - T1 (délai avant que Cathy commence à répondre)
- **Latence de reprise** = T3 - dernier `releaseNativeAudio` (délai avant que l'utilisateur puisse reparler)
