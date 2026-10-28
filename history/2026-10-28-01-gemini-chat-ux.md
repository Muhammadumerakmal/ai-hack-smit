# Gemini model and AI-native chat features (ui-ux-pro-max)

- **Date:** 2026-10-28
- **Commits:** see git log
- **Tests:** ai, ai-audit, unit and security-matrix: 83 passed. Live AI check (`scripts/qa-live-ai.ts`) against Gemini: 14 of 14. Browser check of the new chat controls with real Gemini answers: 6 of 6.

## Changes
- **AI provider:** Gemini `gemini-3.5-flash-lite` (the newest stable Lite model, pinned instead of `-latest`) through Google's OpenAI-compatible endpoint (`AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/`). The OpenAI Agents SDK and the code are unchanged; it was already provider-agnostic through `AI_BASE_URL`. The OpenAI key was removed from local `.env`; the Gemini key lives only there (git-ignored). `.env.example`, README and CLAUDE.md document the Gemini setup without the key.
  - Checked before switching: tool calling and JSON mode both work on this endpoint. Gemini 3.x adds a `thought_signature` to tool calls; the multi-step live checks pass through the Agents SDK.
  - `qa-live-ai.ts` runs inside company 1 now (services need a company context since the multi-company change) and prints the provider host.
- **Chat (ui-ux-pro-max "AI-Native UI" + `ux` guidance):**
  - Context card under each answer, e.g. "Checked: Late arrivals · Payroll". `runChat` returns `sources`: friendly names of the tools that ran, never their data (`sourcesOf` in `chat.ts`).
  - Copy (shows "Copied ✓") and Regenerate on the latest answer (AI feedback loop).
  - After 5 s the typing indicator says "Still checking…" (explain long waits); the screen reader hears it too.
  - "New chat" asks first (Keep / Clear), since it clears the conversation.
  - Reading older messages: a new answer shows a "New answer ↓" button instead of moving the scroll.
  - Answers fade in (off under reduced motion).

## Open / next
- **Vercel still has the old OpenAI settings.** Set `AI_API_KEY` (the Gemini key), `AI_MODEL=gemini-3.5-flash-lite` and `AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/` in the Vercel project, then redeploy. Only the owner can do this.
