# Professional chat UI (ui-ux-pro-max)

- **Date:** 2026-10-28
- **Commits:** see git log
- **Tests:** typecheck and lint clean; production build. Browser check with a mocked AI for controlled timing: 6/6 (topic cards, timer and busy note while waiting, Stop, Ask again, answer with source chips and times, expanded panel, full screen on phones).

## Changes (`components/ai/AiChatPanel.tsx`, `ai/api.ts`)
- **Calm header** (minimal chrome): a white/glass bar with a small violet icon, "HR Assistant" and "{Company} · {Role} access", instead of the loud violet gradient. The icon buttons are New chat, Expand/Smaller and Close.
- **Expand:** desktop switches between a compact window (420 px) and a full-height side panel (680 px). Answers are capped at about 68 characters per line (skill: line length). Phones are always full screen, with a safe-area bottom.
- **Topic cards** to start, per role (Attendance, Leave, Payroll or Pay, Policy, …), each with an example question. The greeting says the assistant only reads the role's own data.
- **Document-style answers:** "Assistant · hh:mm", a card, "Checked" source chips and Copy / Regenerate. User bubbles are solid violet with a time.
- **Waiting:** "Checking the records · 12 s", with a "The AI service is busy…" note after 8 s. Send becomes **Stop**; `postAi` takes an AbortSignal, and a stopped answer is shown neutrally with "Ask again".
- A character counter appears near the 2,000 limit. The launcher and avatars use `glass-gloss`.
- Everything else is kept: sources, copy, regenerate, retry, the New-chat confirmation, the "New answer" jump, one live region, and markdown rendered as React elements.

## Notes
- Stop only stops the browser's wait. The server run continues, and if it completes, its answer goes into the server-side history.
