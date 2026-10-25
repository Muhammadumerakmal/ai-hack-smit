# Bonus features (Section 5 and Section 8 bonus list)

- **Date:** 2026-10-25
- **Commits:** uncommitted
- **Tests:** npm test: 243 passed (211 before + 32 new in `tests/bonus.test.ts`, `tests/bonus.db.test.ts`). Typecheck, lint and `next build` clean.

## Changes
- Camera check-in on the web: `CameraCheckIn.tsx` (MediaPipe face landmarker counts faces and detects a blink on the device), with GPS sent to the same `POST /api/attendance/check-in` (body `{ method: "camera", ... }`; `{}` is still a web check-in). The server rule `evaluateCameraCheckIn` checks for exactly one face, a blink, accuracy of 100 m or better, and a Haversine distance within the radius, else 422. It stores `source`, `distanceMeters` and `gpsAccuracy`, never a photo or coordinates.
- `CompanySettings.cameraRequired`: the plain web check-in returns 403 `camera_required`. It can't be enabled without an office location (400).
- `CompanySettings.latePenaltyEnabled`: 3 lates = 0.5 day, in payroll (`Payslip.lateDays`, `latePenaltyDays`), the payroll table, the payslip PDF and the policy text.
- `insights.service.ts`: rule-based attrition risk (90-day window) and absence anomaly flags. They are on the HR/Admin dashboards, in the KPI JSON (so the AI summary can quote them), and behind the new AI tool `get_people_insights` (Admin/HR).
- The attendance board marks camera check-ins. Settings has a "Use my current location" button and the two rule switches.
- PWA: manifest, icons, service worker with an offline page, apple-touch icon, theme colour, and strict headers for `/sw.js`.
- `readJson(req, schema, emptyAs)` treats an empty body as `emptyAs`.

## Decisions
- The face check runs only in the browser and the server trusts the face count and blink flags it receives (the brief says the phone sends data and the server decides distance and rules). The location and attendance rules are enforced on the server.
- The late penalty is off by default so the Section 3 payroll formula and its tests are unchanged.
- Risk and anomalies are explainable rules over `getDayRows`, not an ML model, so every number matches the calendar and can't be invented by the AI.
- The service worker is never registered in dev and never caches `/api`.
- Pinned `@mediapipe/tasks-vision@0.10.21` (the wasm CDN URL in `CameraCheckIn.tsx` must match).

## Open / next
- The hosted Neon DB needs `npx prisma db push` (direct URL) for the new columns before deploying this build.
- Face matching against an enrolled face and a native mobile app are not done.
