# ui-ux-pro-max pass 2: form errors, keyboard navigation, chat announcements

- **Date:** 2026-10-27
- **Commits:** see git log
- **Tests:** npm test: 272 (1 new unit test). Typecheck and lint clean. Browser checks in headless Chrome (8 of 8).

## Changes (each from a ui-ux-pro-max `ux` guideline)
- **Errors under the field (High):** a 400 from zod now also returns `fields` (`{ adminPassword: "Password needs a number" }`, plain words via `fieldErrors()` in `src/lib/api.ts`). Its `message` is a readable summary ("Admin password: Password needs a number.") instead of zod's `✖ … → at …`. `ApiError.fields` and `fieldErrorsOf()` live in `lib/client.ts`. `<FieldErrors>` + `<Field name="…">` in `components/ui.tsx` show the error under its input, with `aria-invalid` and `aria-describedby` and a red border. Wired into Create your company, Change password, Create HR login, Register employee, Announcements and Company settings.
- **Required indicators (Medium):** `Field` shows a red `*` when its control is `required` (screen readers already hear "required").
- **Skip link (Medium):** "Skip to main content" is the first Tab stop and focuses `<main id="main">`.
- **No hidden Tab stops (High):** the closed phone menu is now `invisible` as well as off-screen (visibility waits for the slide), so Tab and screen readers skip it. The menu also closes with Escape, has its own close button, and the open button has `aria-expanded` and `aria-controls`.
- **One meaningful live region (High):** the chat had the whole message list as a live region (it re-read the user's own question) plus a second status bubble. Now one hidden status says "Checking the records…" and then "Assistant: …" (markdown stripped) or the error.

## Checked and fine
- Loading buttons are disabled while busy. Charts don't rely on colour alone (single series, values as text). Errors use `role="alert"`.

## Open / next
- Smaller forms (leave request, holidays, attendance correction) still show only the summary line. It is readable now, but not under each field.
- In dev the first Tab stop is the Next.js dev-tools badge; production builds don't have it.
