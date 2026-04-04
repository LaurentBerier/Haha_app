# Code Review Snapshot — 2026-04-04 (Full Security + Performance Audit)

## Scope

- Repository: `/Users/laurentbernier/Documents/HAHA_app`
- Focus: comprehensive security review, mobile performance/resource audit, polish suggestions
- Validation set:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run test:unit`

## Findings Fixed in This Pass

### 1) CRITICAL: Prompt injection via user profile data in system prompt (Fixed)

- File: [`api/claude.js`](/Users/laurentbernier/Documents/HAHA_app/api/claude.js) — `buildUserProfileSection`
- Details:
  - `preferredName` and `interests` were interpolated directly into the Claude system prompt without isolation.
  - A user could set their preferred name to a string containing instruction text to alter Claude's behaviour.
  - Fixed by wrapping user-controlled values in `<user_value>…</user_value>` XML delimiters and adding an explicit note at the top of the profile section instructing Claude to treat tagged content as data only.
  - `interests` also strip embedded HTML tags before wrapping.
- Coverage: updated `api/__tests__/claude.test.js` assertions to match the new format.

### 2) HIGH: Internal DB schema leaked in error responses (Fixed)

- Files: [`api/admin-stats.js`](/Users/laurentbernier/Documents/HAHA_app/api/admin-stats.js), [`api/admin-user-reset.js`](/Users/laurentbernier/Documents/HAHA_app/api/admin-user-reset.js), [`api/subscription-summary.js`](/Users/laurentbernier/Documents/HAHA_app/api/subscription-summary.js), [`api/payment-webhook.js`](/Users/laurentbernier/Documents/HAHA_app/api/payment-webhook.js), [`api/subscription-cancel.js`](/Users/laurentbernier/Documents/HAHA_app/api/subscription-cancel.js), [`api/stripe-webhook.js`](/Users/laurentbernier/Documents/HAHA_app/api/stripe-webhook.js)
- Details:
  - Raw Supabase/PostgreSQL error messages (table names, column names, constraint names) were returned verbatim in 500 responses.
  - Replaced with generic client-facing strings. Full errors still logged server-side via `console.error`.

### 3) MEDIUM: Rate-limit bypass relied solely on NODE_ENV (Fixed)

- File: [`api/_utils.js`](/Users/laurentbernier/Documents/HAHA_app/api/_utils.js) — `shouldBypassIpRateLimitWhenKvUnavailable`
- Details:
  - If `NODE_ENV` was unset in a Vercel deployment, IP rate limiting would be silently bypassed.
  - Added an explicit `DISABLE_IP_RATE_LIMIT=true` env var guard as primary bypass mechanism. `NODE_ENV` dev/test shortcut is preserved as secondary.

### 4) MEDIUM: Admin user search used string interpolation in `.or()` (Cleaned up)

- File: [`api/admin-users.js`](/Users/laurentbernier/Documents/HAHA_app/api/admin-users.js)
- Details:
  - The non-UUID, non-idText branch used an intermediate `clauses` array + `.join(',')` before string interpolation into `.or()`. Simplified to a direct conditional expression.

### 5) HIGH: TTS concurrency unbounded — up to 30+ simultaneous ElevenLabs requests (Fixed)

- File: [`src/hooks/useChat.ts`](/Users/laurentbernier/Documents/HAHA_app/src/hooks/useChat.ts) — `queueTtsChunk`
- Details:
  - Every streamed text chunk launched a `fetchAndCacheVoice()` call immediately, with no backpressure. A long response (~30 chunks) would saturate the network with simultaneous requests, causing CPU and battery spikes.
  - Added a semaphore (`MAX_TTS_CONCURRENT = 3`) with a draining queue (`ttsConcurrencyQueue`). Chunks beyond the limit are queued and dispatched as in-flight requests complete.

### 6) HIGH: Store persistence debounced save lost on unmount (Fixed)

- File: [`src/hooks/useStorePersistence.ts`](/Users/laurentbernier/Documents/HAHA_app/src/hooks/useStorePersistence.ts)
- Details:
  - The cleanup function cancelled the debounce timer without flushing, so the last user action (sent message, selected artist, etc.) was silently lost when the app backgrounded or navigated away mid-timer.
  - Cleanup now saves the snapshot immediately before unsubscribing.

### 7) MEDIUM: Audio listener cleanup order defensive improvement (Fixed)

- File: [`src/hooks/useAudioPlayer.ts`](/Users/laurentbernier/Documents/HAHA_app/src/hooks/useAudioPlayer.ts)
- Details:
  - `clearWebListeners()` was called after `addEventListener` instead of before. Moved to before attachment so old listeners are always detached before new ones are added, regardless of call ordering.

### 8) MEDIUM: `VOICE_HYDRATION_ATTEMPTS` Set never expired (Fixed)

- File: [`src/components/chat/ChatBubble.tsx`](/Users/laurentbernier/Documents/HAHA_app/src/components/chat/ChatBubble.tsx)
- Details:
  - Module-level `Set` tracking voice hydration attempts was unbounded. A transient TTS failure permanently blocked retry for that message ID for the remainder of the app session.
  - Replaced with a bounded `Map`-based LRU (max 200 entries). Eviction uses `Map` insertion order (O(1)). Failed attempts can be retried after eviction.

### 9) MEDIUM: FlatList `renderItem` recreated on every audio state change (Fixed)

- File: [`src/components/chat/MessageList.tsx`](/Users/laurentbernier/Documents/HAHA_app/src/components/chat/MessageList.tsx)
- Details:
  - `audioPlayer` was in `renderItem`'s `useCallback` deps. Since `useAudioPlayer` returns a new object on every state tick (isPlaying, isLoading, etc.), `renderItem` was recreated on every tick, causing all visible `ChatBubble` instances to re-render even for unrelated audio state.
  - Fixed: `audioPlayerRef` holds the latest `audioPlayer` value (updated synchronously each render). `renderItem` reads `audioPlayerRef.current` instead of the prop directly. `audioPlayer` removed from deps. `extraData={audioPlayer}` added to `FlatList` so React Native still re-renders visible items on audio state changes — but via `extraData` rather than a new `renderItem` reference.

## Residual Risks / Out of Scope

- Global voice session state in `src/services/voiceEngine.ts` (module-level singletons for session ID/listeners) is a refactor-scope change; deferred.
- `messageSlice` cloud sync re-sorts all messages O(n log n) on each sync; optimization deferred.
- E2E (Detox) flows not rerun in this pass.
- Analytics remain disabled (`enableAnalytics: false` in `featureFlags.ts`).

## Validation

- `npm run typecheck` → PASS
- `npm run lint` → PASS
- `npm run test:unit` → PASS (`99` suites, `550` tests)
