# Chat migrated to OpenAI Agents SDK

- **Date:** 2026-10-25
- **Commits:** 6f2e7e9, 24fc860, beab17e
- **Tests:** not recorded

## Changes
- Added the `@openai/agents` dependency.
- The chat tool loop in `src/server/ai/chat.ts` now runs on an Agents SDK `Agent` + `run()` (max 4 tool rounds, 800 output tokens). Tools still go through `runTool` and its role check.
- Server-persisted conversations: `ChatConversation` / `ChatMessage` models, `PrismaChatSession` (`src/server/ai/chat-session.ts`) implements the SDK `Session` interface, and `/api/ai/conversations` routes list, read and delete them.
- The chat request body is now `{ conversationId, message }`. The browser no longer sends history.
- Tests use `ScriptedModel` (`tests/ai-fake.ts`) injected through `setChatModel`.

## Decisions
- History is stored and replayed server-side (last 10 messages) so the client can't inject system, assistant or tool turns. Only plain user/assistant text is persisted, and a failed run writes nothing.
- Summary and smart leave stay on the thin `llm.ts` client (JSON mode + one retry). Only chat moved to the SDK.

## Open / next
- Run the full `npm test` and record the count.
