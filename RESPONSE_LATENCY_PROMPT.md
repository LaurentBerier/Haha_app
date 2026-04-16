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
- ~~React render cycle (isPlaying=false → auto-listen trigger): ~400ms~~ → **Bypassed** via `onQueueCompleteRef` callback (2026-04-16)
- Délai recognizer (yield iOS): 50ms
- `configureAudioSessionForRecording`: SKIP si flag (0ms) ou ~400ms sinon
- `module.start()` → `audiostart`: ~1200ms (SFSpeechRecognizer startup natif)
- **Total estimé après optimisation: ~1.5-2.1s** (était ~1.9-2.5s)

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

## Pistes d'optimisation

### 1. Réduire le silence timeout intelligemment (à explorer)
- Silence timeout adaptatif: plus court après une question directe de Cathy, plus long quand l'utilisateur raconte une histoire
- Détecter les patterns de fin de phrase (intonation descendante via les résultats STT intermédiaires, ponctuation ajoutée par le recognizer)
- Valeur actuelle: 1800ms. Cible possible: 1000-1200ms pour les réponses courtes

### 2. Pré-démarrer le STT pendant le dernier chunk TTS (à explorer)
- Anticiper la fin du playback: quand on joue le dernier chunk de la queue, on pourrait commencer à préparer le STT (pre-load le module, configurer l'audio session dès que le chunk est presque fini)
- Risque: changer l'audio session trop tôt coupe le dernier mot du TTS

### 3. Streaming TTS + début de playback plus tôt (à explorer)
- Commencer le playback dès que le premier chunk TTS est prêt au lieu d'attendre la réponse complète
- Déjà partiellement implémenté via `appendToQueue`, mais le premier chunk attend la première phrase complète de l'API

### 4. ~~Réduire le overhead React~~ ✅ IMPLÉMENTÉ (2026-04-16)
- **Problème:** Le cycle React (state update → re-render → effect trigger) ajoutait ~400ms entre la fin du TTS et le redémarrage du STT.
- **Solution:** Ajout d'un `onQueueCompleteRef` callback dans `useAudioPlayer.ts`. Quand le dernier chunk audio finit, le callback se déclenche *avant* `stop()` et ses state updates React, permettant à `useVoiceConversation` de démarrer le `startListeningFlow('auto')` immédiatement.
- **Fichiers modifiés:** `useAudioPlayer.ts` (callback ref + appel dans `onChunkEnd`), `useVoiceConversation.ts` (effet qui enregistre le callback), `mode-select/index.tsx` et `chat/[conversationId].tsx` (passage du ref)
- **Gain estimé:** ~400ms sur le segment T3

### 5. Audio session pre-warming (à explorer)
- Appeler `setAudioModeAsync({allowsRecording: true})` en background pendant les dernières secondes du playback TTS, sans couper le son (si iOS le permet)
- Ou: garder l'audio session en mode recording même pendant le playback (nécessite de vérifier si le playback fonctionne avec `allowsRecording: true`)

### 6. ~~Réduire les erreurs transient tuant la session web~~ ✅ IMPLÉMENTÉ (2026-04-16)
- **Problème:** Sur iOS Safari, les erreurs `audio-capture` après un changement de route audio (ex: haut-parleur reconfiguré après TTS) étaient classées comme `permission`, tuant la session vocale au lieu de permettre le recovery.
- **Solution:** `classifyWebErrorReason()` inspecte maintenant le message d'erreur avant de classifier `audio-capture` — seulement `permission` si le message mentionne "not allowed"/"denied"/"permission", sinon `transient` (recoverable). Miroir de la logique native `classifyNativeErrorReason()`.
- **Fichier modifié:** `voiceEngine.ts`

### 7. ~~Post-playback STT recovery sur iOS Safari~~ ✅ IMPLÉMENTÉ (2026-04-16)
- **Problème:** `shouldUsePostPlaybackStartupRecovery()` retournait `false` pour tout le web. Sur iOS Safari, le STT peut échouer après le TTS sans `audiostart` (même pattern que natif), mais aucun recovery dédié n'existait.
- **Solution:** Le guard passe de `platformOs === 'web'` à `platformOs === 'web' && !isIosWebRuntime`. iOS Safari obtient maintenant le même recovery post-playback que le natif.
- **Fichiers modifiés:** `useVoiceConversation.ts` (interface + guard + call site), `useVoiceConversation.test.ts`

### 8. ~~Délai de restart STT web sur iOS Safari~~ ✅ IMPLÉMENTÉ (2026-04-16)
- **Problème:** Le restart du Web SpeechRecognition dans `onend` était immédiat. Sur iOS Safari, ça pouvait conflictuer avec le cleanup de la session précédente.
- **Solution:** Sur iOS Safari uniquement, 50ms de délai avant `recognition.start()` dans le handler `onend`, mirroring le délai natif de 50ms.
- **Fichier modifié:** `voiceEngine.ts`

### 9. ~~Yield audio release avant STT restart sur iOS Safari~~ ✅ IMPLÉMENTÉ (2026-04-16)
- **Problème:** `onQueueCompleteRef` démarrait le STT immédiatement. Sur iOS Safari, `audio.load()` (appelé par `releaseWebAudio`) a besoin de temps pour libérer le hardware audio.
- **Solution:** 50ms de yield dans le callback `onQueueComplete` sur iOS Safari avant de démarrer le STT.
- **Fichier modifié:** `useVoiceConversation.ts`

## Optimisations de rendering implémentées (2026-04-16)

Ces optimisations ne touchent pas directement la latence vocale mais améliorent la fluidité générale sur iPhone 13:

- **`MessageList.tsx`:** Suppression de `extraData={audioPlayer}` qui causait le re-render de tous les ChatBubbles visibles à chaque tick audio (~60Hz)
- **`ChatBubble.tsx`:** Sélecteurs Zustand primitifs (`artistId`, `language`) au lieu d'un objet conversation complet
- **`_layout.tsx` + `mode-select/index.tsx`:** Groupement des sélecteurs Zustand avec `useShallow` pour éviter les re-renders en cascade
- **`AmbientGlow.tsx`:** Pause des 4 animations infinies quand l'écran n'est pas focused (prop `isActive`)
- **`ttsService.ts`:** `Promise.any()` au lieu du fallback séquentiel — latence max TTS réduite de 40s à 10s
- **`imageUploadPreparation.ts`:** Recherche binaire sur la qualité JPEG — réduit les appels `manipulateAsync` de ~42 à ~10

## Fichiers impliqués

| Fichier | Ce qu'il contrôle |
|---------|-------------------|
| `src/hooks/useAudioPlayer.ts` | Playback TTS, queue, transitions audio session |
| `src/hooks/useVoiceConversation.ts` | State machine voix, silence timeout, auto-listen, recovery, post-playback recovery (natif + iOS web) |
| `src/services/voiceEngine.ts` | STT natif + web, démarrage/arrêt recognizer, classification erreurs (natif + web) |
| `src/services/audioSessionState.ts` | Flag partagé pour skip appels audio session redondants |
| `src/contracts/conversationContracts.ts` | Constantes: silence timeout, recovery delays |
| `src/platform/platformCapabilities.ts` | Détection plateforme: `isIosMobileWebRuntime()`, UA patterns |

## Métriques à suivre

Utiliser les logs `[STT_DEBUG]` (via `sttDebugLogger.ts` → serveur port 9999 → `/tmp/stt_debug.log`) pour mesurer:
- **T1**: timestamp du `silenceTimeout fired` (utilisateur a fini de parler)
- **T2**: timestamp du premier `playQueue: setting allowsRecording=false` (premier audio TTS prêt)
- **T3**: timestamp du `native 'audiostart' event` après la fin du TTS (mic live à nouveau)
- **Latence perçue** = T2 - T1 (délai avant que Cathy commence à répondre)
- **Latence de reprise** = T3 - dernier `releaseNativeAudio` (délai avant que l'utilisateur puisse reparler)
