# Conversation flow architecture

Last updated: **2026-04-14**

This document is the **canonical map** for Conversation Naturelle across iOS, Android, and web (mobile + desktop). Implementation details live in code; behavioral contracts live in [`src/contracts/conversationContracts.ts`](../src/contracts/conversationContracts.ts).

## Send path (text + launch intents)

All user sends that can start a mode/game from natural language go through one helper:

| Step | Module | Responsibility |
|------|--------|----------------|
| Launch gate | [`src/services/conversationSendOrchestrator.ts`](../src/services/conversationSendOrchestrator.ts) | `attemptExperienceLaunchBeforeSend` → delegates to `experienceLaunchService` |
| Global composer (floating input) | [`src/app/_layout.tsx`](../src/app/_layout.tsx) | `planGlobalComposerSend` → queue + navigate to `/chat/[conversationId]` |
| Chat screen | [`src/app/chat/[conversationId].tsx`](../src/app/chat/[conversationId].tsx) | Same launch gate, then `sendMessage` (+ optional voice filler) |
| Mode-select inline | [`src/app/mode-select/[artistId]/index.tsx`](../src/app/mode-select/[artistId]/index.tsx) | Same launch gate, then bound-conversation send + recovery |

## Voice / mic

- State machine: [`src/hooks/useVoiceConversation.ts`](../src/hooks/useVoiceConversation.ts) (timeouts/recovery delays sourced from `conversationContracts`).
- Engines: [`src/services/voiceEngine.ts`](../src/services/voiceEngine.ts).

## Auth vs conversation

- Callback URL / duplicate guard / mobile-web → native handoff:
  - [`src/app/auth/callback.tsx`](../src/app/auth/callback.tsx)
  - [`src/auth/authCallbackGuards.ts`](../src/auth/authCallbackGuards.ts)
  - [`src/platform/platformCapabilities.ts`](../src/platform/platformCapabilities.ts)
- Layout must not redirect away from `/auth/callback` while exchange runs: [`src/hooks/useLayoutAuthGate.ts`](../src/hooks/useLayoutAuthGate.ts) + [`src/contracts/authLifecycleContracts.ts`](../src/contracts/authLifecycleContracts.ts).
- Magic link intent from login: [`src/services/authMagicLinkUi.ts`](../src/services/authMagicLinkUi.ts) (`auto`).

## Web route resume

- Keys and helpers: [`src/utils/routeRestore.ts`](../src/utils/routeRestore.ts) (`WEB_RESUME_ROUTE_RESTORE_FLAG_KEY`, `LAST_USEFUL_ROUTE_STORAGE_KEY`).

## Test matrix (manual smoke)

| Surface | Send + launch intent | Voice mic | Auth callback |
|---------|---------------------|-----------|---------------|
| iOS app | Global input → chat; mode inline | Native STT | Deep link `hahaha://auth/callback` |
| Android app | Same | Native STT | Same |
| Mobile web | Same; optional handoff to app | Web Speech API | `/auth/callback` + handoff when applicable |
| Desktop web | Same | Web Speech API | `/auth/callback` (no handoff) |

## Automated tests (behavior-first)

- Orchestrator / global send planning: `src/services/conversationSendOrchestrator.test.ts`
- Auth guards: `src/auth/authCallbackGuards.test.ts`
- Magic link intent: `src/services/authMagicLinkUi.test.ts`, `src/tests/auth/login.magic-link-intent.test.ts`
- Mobile web handoff decision: `src/platform/platformCapabilities.test.ts`
