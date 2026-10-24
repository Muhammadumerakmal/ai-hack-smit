/**
 * Calendar dates are handled as ISO strings ("2026-10-24") and stored as Postgres DATE columns,
 * so there is no timezone drift. "Today" is always computed in the company timezone.
 */
export const APP_TZ = process.env.APP_TZ ?? "Asia/Karachi";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: string): boolean {
  if (!ISO_RE.test(s)) return false;
  const d = toDate(s);
  return !Number.isNaN(d.getTime()) && toIso(d) === s;
}

export function todayIso(now: Date = new Date(), tz: string = APP_TZ): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** ISO date → Date at UTC midnight (what Prisma expects for @db.Date). */
export function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

export function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(iso: string): number {
  return toDate(iso).getUTCDay();
}

export function weekdayName(iso: string): string {
  return WEEKDAYS[weekdayOf(iso)];
}

export function eachDay(start: string, end: string): string[] {
  const days: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  return days;
}

export function isWorkingDay(iso: string, weekendDays: number[], holidays: Set<string>): boolean {
  return !weekendDays.includes(weekdayOf(iso)) && !holidays.has(iso);
}

export function workingDays(start: string, end: string, weekendDays: number[], holidays: Set<string>): string[] {
  return eachDay(start, end).filter((d) => isWorkingDay(d, weekendDays, holidays));
}

/** "2026-10" → first and last day of that month. */
export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

export function currentMonth(now: Date = new Date()): string {
  return todayIso(now).slice(0, 7);
}

export function yearRange(year: number): { start: string; end: string } {
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

export function minIso(a: string, b: string): string {
  return a < b ? a : b;
}

export function maxIso(a: string, b: string): string {
  return a > b ? a : b;
}

/** Wall-clock "HH:MM" and minutes-since-midnight of an instant in the company timezone. */
export function localClock(at: Date, tz: string = APP_TZ): { hhmm: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return { hhmm: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, minutes: h * 60 + m };
}

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** "2026-10-26" + "09:30" in the company timezone → the UTC instant. */
export function zonedDateTime(dateIso: string, hhmm: string, tz: string = APP_TZ): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const guess = new Date(`${dateIso}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
  // Offset of the zone at that moment (handles DST zones too).
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(guess)
      .map((x) => [x.type, x.value]),
  );
  const asIfUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  return new Date(guess.getTime() - (asIfUtc - guess.getTime()));
}
