# PDF gap audit: face matching and payroll cost by month

- **Date:** 2026-10-25
- **Commits:** uncommitted
- **Tests:** npm test: 252 passed (9 new). Lint and `next build` clean.

## Changes
- Went through the brief section by section against the code. Two gaps were left: the Section 7 metric "payroll cost by month" and the Section 5 extra bonus "match the face to the employee's enrolled face".
- `getPayrollTrend` (analytics): gross and net per payroll run for the last 12 months, with the department filter. It's on the Admin dashboard ("Payroll cost by month", chart + table) and in the KPI JSON as `payrollByMonth`.
- Face matching: a `FaceProfile` table (employeeId, 128-float descriptor, enrolledAt). `GET/POST /api/attendance/face` is self-service enrolment (once only, then 409). `DELETE /api/employees/:id/face` lets HR reset it (audited, notifies the employee). Camera check-in requires a matching descriptor (Euclidean distance of 0.55 or less) when a face is enrolled, and stores `Attendance.faceVerified`.
- UI: the camera dialog has an enrol mode, check-in sends a descriptor when enrolled, there's a "Face check-in" card on Employee 360 (enrol on My profile, reset for HR), and the check-in widget suggests enrolling.
- New routes added to the security matrix.

## Decisions
- The descriptor lives in its own table, because employee rows get spread into API responses and audit JSON. Employee 360 only exposes `{ enrolled, enrolledAt }`.
- Matching runs on the server. The browser only computes the descriptor, using face-api.js (MediaPipe has no face-recognition embeddings). MediaPipe still does the live face count and blink check.
- Re-enrolment needs an HR reset, so nobody can quietly swap in someone else's face.
- No face enrolled still means the face/blink/location checks apply, with `faceVerified = null`. Making enrolment mandatory was left out to keep the demo flow short.

## Open / next
- The hosted Neon DB needs `npx prisma db push` again for `face_profiles` and `attendance.faceVerified`.
- A native mobile app (optional) is not built.
