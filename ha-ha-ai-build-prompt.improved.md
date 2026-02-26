# Ha-Ha.ai — Implementation Prompt (Improved)

> Note: This document is kept as a build prompt reference. The current codebase has evolved and now includes live Claude integration (`claudeApiService.ts`) in addition to mock mode.

## Role and Objective
You are a senior React Native engineer. Build **Phase 1** of Ha-Ha.ai as a production-grade Expo app with clean architecture, strict TypeScript, and a dual backend strategy (live Claude + mock fallback).

Primary outcome: a user can select Cathy Gauthier and chat with a high-fidelity AI persona through streamed responses.

## Non-Negotiable Constraints
1. Use **Expo (latest stable)** + **TypeScript strict mode**.
2. Use **Expo Router** for navigation.
3. Use **Zustand** with separate slices for domain/UI concerns.
4. No business logic in UI components.
5. No network/service calls in components.
6. Artist data must come from config (`/src/config/artists.ts`), never hardcoded in UI.
7. All prompts are dynamically assembled. No static monolithic prompt string.
8. All user-facing strings go through i18n (`fr-CA` default).

## Tech Decisions
- State: Zustand (modular slices merged in one store).
- Styling: React Native `StyleSheet` + centralized theme module.
- Lists: `FlatList` tuned for large message history.
- Local storage:
  - sensitive: `expo-secure-store`
  - non-sensitive: `@react-native-async-storage/async-storage`
- Backend in Phase 1: live Claude service with mock fallback.

## Required Folder Structure
```text
/src
  /app
    _layout.tsx
    index.tsx
    /mode-select
      [artistId].tsx
    /chat
      [conversationId].tsx
    /settings
      index.tsx
  /components
    /chat
      ChatBubble.tsx
      ChatInput.tsx
      MessageList.tsx
      StreamingIndicator.tsx
    /artist
      ArtistCard.tsx
      ArtistAvatar.tsx
    /common
      Button.tsx
      Header.tsx
      LoadingSpinner.tsx
      PremiumBadge.tsx
  /store
    useStore.ts
    /slices
      artistSlice.ts
      conversationSlice.ts
      messageSlice.ts
      subscriptionSlice.ts
      artistAccessSlice.ts
      usageSlice.ts
      uiSlice.ts
  /models
    Artist.ts
    Conversation.ts
    Message.ts
    Subscription.ts
    Usage.ts
  /services
    personalityEngine.ts
    personalityEngineService.ts
    claudeApiService.ts
    mockLlmService.ts
    voiceEngine.ts
    subscriptionService.ts
    analyticsService.ts
  /hooks
    useChat.ts
    useArtist.ts
    useSubscription.ts
    useStreamingMessage.ts
  /theme
    colors.ts
    typography.ts
    spacing.ts
    index.ts
  /utils
    formatDate.ts
    generateId.ts
    localization.ts
  /config
    artists.ts
    env.ts
    constants.ts
    featureFlags.ts
  /data
    /cathy-gauthier
      personalityBlueprint.ts
      modePrompts.ts
      modeFewShots.ts
  /i18n
    fr.ts
    en.ts
    index.ts
```

## Domain Models (Implement Exactly)
```ts
export interface Artist {
  id: string;
  name: string;
  slug: string;
  avatarUrl: string;
  supportedLanguages: string[];
  defaultLanguage: string;
  supportedModeIds: string[];
  isPremium: boolean;
  voiceEnabled: boolean;
  personalityProfile: PersonalityProfile;
  pricingConfig: PricingConfig;
}

export interface PersonalityProfile {
  toneMetrics: {
    aggression: number;
    warmth: number;
    sarcasm: number;
    absurdity: number;
    vulgarityTolerance: number;
    judgmentIntensity: number;
    selfDeprecation: number;
  };
  humorMechanics: {
    escalationStyle: string;
    punchlineDelay: string;
    repetitionUsage: string;
    exaggerationLevel: number;
    contrastHumor: string;
    audienceConfrontation: string;
  };
  speechPattern: {
    averageSentenceLength: string;
    interruptionStyle: boolean;
    rhythmStyle: string;
    regionalisms: string;
  };
  thematicAnchors: string[];
  guardrails: {
    hardNo: string[];
    softZones: { topic: string; rule: string }[];
  };
}

export interface Conversation {
  id: string;
  artistId: string;
  title: string;
  language: string;
  modeId: string;
  createdAt: string;
  updatedAt: string;
  lastMessagePreview: string;
}

export type MessageStatus = 'pending' | 'streaming' | 'complete' | 'error';
export type MessageRole = 'user' | 'artist';

export interface MessageMetadata {
  tokensUsed?: number;
  voiceUrl?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  timestamp: string;
  metadata?: MessageMetadata;
}

export type SubscriptionTier = 'free' | 'core' | 'pro';

export interface Subscription {
  tier: SubscriptionTier;
  isActive: boolean;
  renewalDate: string | null;
}

export interface UsageQuota {
  monthlyCap: number;
  used: number;
  resetDate: string;
}
```

## Store Contract
Implement 7 slices and merge into `useStore.ts`.

- `artistSlice`
  - `artists: Artist[]`
  - `selectedArtistId: string | null`
  - `selectArtist(id)`
  - `getSelectedArtist()`
- `conversationSlice`
  - `conversations: Record<string, Conversation[]>`
  - `activeConversationId: string | null`
  - `createConversation(artistId, language, modeId)`
  - `setActiveConversation(id)`
  - `updateConversation(id, updates)`
- `messageSlice`
  - `messagesByConversation: Record<string, MessagePage>`
  - `addMessage(conversationId, message)`
  - `updateMessage(conversationId, messageId, updates)`
  - `appendMessageContent(conversationId, messageId, token)`
  - `getMessages(conversationId)`
- `subscriptionSlice`
  - `subscription: Subscription`
  - `setSubscription(sub)`
  - `canAccessFeature(feature)`
- `artistAccessSlice`
  - `unlockedArtistIds: string[]`
  - `unlockArtist(id)`
  - `isArtistUnlocked(id)`
- `usageSlice`
  - `quota: UsageQuota`
  - `incrementUsage(tokens)`
  - `isQuotaExceeded()`
  - `resetQuota()`
- `uiSlice`
  - `isLoading: boolean`
  - `isSidebarOpen: boolean`
  - `currentModal: string | null`
  - `keyboardVisible: boolean`
  - `setLoading(val)`

## Personality Engine Requirements
Files:

- `/src/services/personalityEngineService.ts` (active)
- `/src/services/personalityEngine.ts` (retained for compatibility)

Implement a **pure** function:
```ts
function assemblePrompt(params: {
  artist: Artist;
  conversationHistory: Message[];
  userMessage: string;
  language: string;
  contextSignals?: Record<string, unknown>;
}): { systemPrompt: string; userTurn: string }
```

Rules:
1. Build prompt from modular blocks in this order:
   - identity
   - tone
   - humor mechanics
   - speech pattern
   - thematic anchors
   - guardrails
   - language directive
   - conversation context
   - response directive
2. No API call in this file.
3. Keep formatting deterministic for testability.
4. Keep config-driven behavior: editing artist config changes output without touching engine logic.

## Streaming Requirements
1. User message added as `complete`.
2. Insert placeholder artist message as `pending`.
3. Choose backend by flag:
   - `USE_MOCK_LLM=true`: mock stream path
   - `USE_MOCK_LLM=false`: Claude API path
4. On each token/chunk, append content and set `streaming`.
5. On completion, set `complete`.
6. On failure, set `error` and keep partial content.

## UI Scope (Phase 1)
Build:
- Home screen with artist list (Cathy only now).
- Chat screen with streaming bubbles.
- Chat input + send action.
- Conversation creation/selection.
- Typing/streaming indicator.
- Loading and error states.

Do not build yet:
- voice
- payments
- cloud sync
- analytics

## Performance + Quality Gates
- Use `FlatList` with tuned props (`windowSize`, `initialNumToRender`, stable `keyExtractor`).
- Avoid re-render storms: message row components subscribe narrowly and use memoization.
- No inline heavy functions/objects in render paths.
- Streaming must remain responsive on mid-range devices.

## Deliverables (Return Format)
When done, return:
1. `Implemented files` list.
2. `Architecture decisions` (short bullets).
3. `How to run` commands.
4. `Validation performed` (typecheck/lint/tests/manual flow).
5. `Known gaps` (if any).

## Execution Plan
1. Scaffold folders/files.
2. Implement models and config (Cathy profile included).
3. Implement Zustand slices + merged store.
4. Implement personality assembly engine.
5. Implement live Claude service + mock fallback service.
6. Build home/chat/settings screens.
7. Wire hooks and UI components.
8. Add i18n + theme.
9. Verify and fix type/perf issues.

## Acceptance Criteria
- App launches and navigates between home and chat.
- User can start a conversation and send a message.
- Artist response path works in both modes:
  - live Claude API path
  - mock fallback path
- Prompt assembly is dynamic and pure.
- No business logic in components.
- No TypeScript errors in strict mode.
- Code structure matches required folder layout.
- Architecture is ready for multi-artist expansion without refactor.

## Cathy Seed Configuration Requirements
In `/src/config/artists.ts`, include one launch artist (`cathy-gauthier`) with:
- `supportedLanguages`: `['fr-CA', 'fr-FR', 'en-CA']`
- aggressive/sarcastic high-tone profile
- Quebec French conversational register
- explicit hard-no and soft-zone guardrails

Keep wording policy-safe while preserving comedic edge.
