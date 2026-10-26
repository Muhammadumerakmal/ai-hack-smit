// Formatting helpers for the operations screens (attendance, leave, payroll, payslips).
// Company time is Asia/Karachi, matching the server's APP_TZ.

export const COMPANY_TZ = "Asia/Karachi";

/** YYYY-MM-DD for "today" in company time. */
export function companyToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: COMPANY_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export const companyMonth = (now: Date = new Date()) => companyToday(now).slice(0, 7);

/** "2026-10" → "October 2026" */
export function monthLabel(month: string, style: "long" | "short" = "long"): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: style, year: "numeric", timeZone: "UTC" });
}

/** "2026-10" ± n months */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "26 Oct – 27 Oct 2026" (or a single day) */
export function fmtRange(start: string, end: string): string {
  const d = (iso: string, withYear: boolean) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(withYear && { year: "numeric" }), timeZone: "UTC" });
  if (start === end) return d(start, true);
  return `${d(start, start.slice(0, 4) !== end.slice(0, 4))} – ${d(end, true)}`;
}

export function weekdayShort(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
}

/** Minutes between two ISO instants (or until now when `to` is missing). */
export function minutesBetween(from: string | null | undefined, to?: string | null, now: number = Date.now()): number | null {
  if (!from) return null;
  const end = to ? new Date(to).getTime() : now;
  const mins = Math.floor((end - new Date(from).getTime()) / 60000);
  return mins >= 0 ? mins : null;
}

/** 485 → "8h 05m" */
export function fmtDuration(mins: number | null | undefined): string {
  if (mins == null) return "—";
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}

/** "09:00" + 15 → "09:15" */
export function addClock(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const t = h * 60 + m + minutes;
  return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("") || "?";

export const humanize = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** Sentence case for system values ("not set" → "Not set"); names people typed ("iOS team") stay as written. */
export const labelCase = (s: string) => (s === s.toLowerCase() ? humanize(s) : s);
