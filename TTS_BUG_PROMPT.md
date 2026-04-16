# Historique: Pipeline voix iOS — STT, TTS et latence

## Phase 1 — Fix STT natif iOS (2026-04-15)

Le STT natif iOS était complètement cassé — le micro s'activait brièvement mais aucun transcript n'était jamais produit. Les sessions mouraient en 10ms-1.5s avec `ended_unexpectedly`.

### Root cause trouvée et fixée (3 changements dans `src/services/voiceEngine.ts`):

1. **Race condition de listeners** — Les listeners natifs (`result`, `error`, `end`, `audiostart`) étaient enregistrés de manière synchrone avant `module.start()`, qui était appelé dans une IIFE async différée. Quand `cleanupNativeRecognition()` appelait `module.stop()` sur l'ancienne session, l'événement `end` natif était capté par les listeners de la **nouvelle** session, la tuant avant même que `module.start()` soit appelé. **Fix:** Listeners déplacés à l'intérieur de l'IIFE async, juste avant `module.start()`.

2. **Délai avant `module.start()`** pour donner à iOS le temps de libérer le `SFSpeechRecognizer` de la session précédente (initialement 500ms, réduit à 50ms après optimisation).

3. **`continuous: false` → `continuous: true`** pour iOS natif — le mode single-utterance causait une terminaison immédiate du recognizer sans résultats après que le TTS ait changé l'état de l'audio session.

### Infrastructure de debug en place (temporaire):
- `src/services/sttDebugLogger.ts` — remote logger qui POST les logs `[STT_DEBUG]` vers un serveur HTTP local (port 9999)
- Logs `[STT_DEBUG]` dans `voiceEngine.ts`, `useVoiceConversation.ts`, `useAudioPlayer.ts`
- Serveur de logs: `node /tmp/stt_log_server.js` → écrit dans `/tmp/stt_debug.log`

---

## Phase 2 — Fix TTS audio dropout entre chunks (2026-04-16)

### Symptôme
Après le fix STT, l'audio TTS de Cathy coupait très rapidement après avoir commencé à jouer. Les réponses multi-chunks étaient tronquées ou silencieuses.

### Root cause
Dans `src/hooks/useAudioPlayer.ts`, `playIndex()` appelait `releaseAllAudio()` entre chaque chunk. `releaseAllAudio()` → `releaseNativeAudio()` restaurait `allowsRecording: true` via `setAudioModeAsync()`. Puis le chunk suivant re-settait `allowsRecording: false`. Ce flip-flop par chunk tuait l'audio session iOS.

```
AVANT (par chunk):
  releaseAllAudio() → allowsRecording=true    ← RACE
  setAudioModeAsync → allowsRecording=false   ← immédiatement après
  play chunk
  chunk ends → repeat
```

### Fix appliqué
1. **`releaseNativePlayer()`** (nouveau) — Cleanup léger qui dispose le player natif sans toucher l'audio session
2. **`releaseCurrentPlayers()`** (nouveau) — Combine `releaseWebAudio()` + `releaseNativePlayer()`
3. **`setAudioModeAsync({allowsRecording: false})` déplacé** de `playIndex()` vers `playQueue()` — appelé une seule fois au début de la queue
4. **`playIndex()`** utilise `releaseCurrentPlayers()` au lieu de `releaseAllAudio()`

```
APRÈS:
  playQueue:
    releaseAllAudio() → full teardown
    setAudioModeAsync(false) → UNE SEULE FOIS
    playIndex(0): releaseCurrentPlayers() → player only → play
    playIndex(1): releaseCurrentPlayers() → player only → play
    ...
    stop() → releaseAllAudio() → allowsRecording=true (mic restauré)
```

---

## Phase 3 — Fix classification `audio-capture` (2026-04-16)

### Symptôme
Après TTS, le STT redémarrait mais mourait 5s plus tard avec "Accès au microphone refusé" sans recovery possible.

### Root cause
iOS envoyait une erreur native `audio-capture` avec message "Audio route changed and failed to restart the audio engine" quand le haut-parleur se reconfigurait après le TTS. `classifyNativeErrorReason()` dans `voiceEngine.ts` classifiait `audio-capture` comme `permission`, ce qui tuait le STT sans recovery.

### Fix appliqué
Dans `classifyNativeErrorReason()`: `audio-capture` est maintenant classifié `transient` (recoverable) par défaut. Il n'est classifié `permission` que si le message contient explicitement "not allowed", "denied" ou "permission".

---

## Phase 4 — Optimisation de la latence STT restart (2026-04-16)

### Problème
Après la fin du TTS, le STT prenait ~3.4s pour redémarrer. Trop long pour une conversation naturelle.

### Timeline avant optimisation
```
+0ms     releaseNativeAudio: allowsRecording=true       (TTS terminé)
+400ms   auto-listen effect: triggering                  (React render cycle)
+500ms   waiting 500ms for native recognizer             (délai artificiel)
+900ms   configureAudioSessionForRecording               (REDONDANT — déjà fait par releaseNativeAudio)
+1300ms  module.start()
+2500ms  native 'audiostart' event                       (mic live)
= ~3.4s total
```

### Optimisations appliquées
1. **Délai recognizer: 500ms → 50ms** dans `voiceEngine.ts` — le délai initial était conservateur; avec les fixes de race condition et continuous mode, 50ms suffit
2. **Skip `configureAudioSessionForRecording` redondant** — nouveau module `src/services/audioSessionState.ts` qui track si l'audio session est déjà en mode recording. Quand `releaseNativeAudio` a déjà restauré `allowsRecording=true`, le voiceEngine skip l'appel redondant (~400ms économisés)
3. **`ASSISTANT_BUSY_RECOVERY_DELAY_MS`: 1000ms → 500ms** dans `useVoiceConversation.ts`

### Timeline après optimisation (estimé)
```
+0ms     releaseNativeAudio: allowsRecording=true
+400ms   auto-listen effect: triggering
+50ms    délai recognizer (au lieu de 500ms)
+0ms     configureAudioSessionForRecording: SKIPPED
+~ms     module.start()
+~1200ms native 'audiostart' event
= ~1.9s total (estimé)
```

### Délais incompressibles (natifs iOS)
- React render cycle après state update: ~400ms
- `module.start()` → `audiostart`: ~1200ms (SFSpeechRecognizer startup)
- Ces délais sont contrôlés par iOS et ne peuvent pas être réduits côté code

---

## Fichiers clés

| Fichier | Rôle |
|---------|------|
| `src/hooks/useAudioPlayer.ts` | Audio player, queue TTS, gestion audio session playback |
| `src/hooks/useVoiceConversation.ts` | State machine voix, transitions STT↔TTS, recovery |
| `src/services/voiceEngine.ts` | Moteur STT, natif + web, classification erreurs |
| `src/services/audioSessionState.ts` | Flag partagé pour éviter les appels audio session redondants |
| `src/services/sttDebugLogger.ts` | Logger remote temporaire pour debug iOS |
| `src/contracts/conversationContracts.ts` | Constantes: `VOICE_RECOVERY_DELAYS_MS` [250, 800, 2000] |
