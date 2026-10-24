import { APP_TZ, todayIso, weekdayName } from "@/lib/dates";
import type { Session } from "@/lib/session";
import { getHolidays, getLeaveTypes, getSettings } from "../services/settings.service";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Section 3 business rules as plain text for policy Q&A.
 * Built from the live settings and leave types, so if Admin changes grace time the answer changes too.
 */
export async function buildPolicyText(): Promise<string> {
  const year = todayIso().slice(0, 4);
  const [s, types, holidays] = await Promise.all([getSettings(), getLeaveTypes(), getHolidays(`${year}-01-01`, `${year}-12-31`)]);
  const [h, m] = s.officeStart.split(":").map(Number);
  const lateAfter = `${String(h + Math.floor((m + s.graceMinutes) / 60)).padStart(2, "0")}:${String((m + s.graceMinutes) % 60).padStart(2, "0")}`;
  const quotas = types.length
    ? types.map((t) => `${t.name} (${t.code}): ${t.yearlyQuota == null ? "unlimited" : `${t.yearlyQuota} days per year`}${t.isPaid ? "" : ", unpaid"}`).join("; ")
    : "annual 14, sick 8, casual 10 days per year; unpaid unlimited";

  return `COMPANY POLICY (${s.companyName})
Attendance
- Office starts at ${s.officeStart}. Grace time is ${s.graceMinutes} minutes, so a check-in after ${lateAfter} is late.
- Working less than ${s.halfDayHours} hours in a day counts as a half day.
- Weekend: ${s.weekendDays.map((d) => DAY_NAMES[d]).join(" and ")}.
- The server records the check-in time; employees cannot set it. Only one check-in per day.
- No attendance record and no approved leave on a working day = absent. Checked in but never checked out = missing checkout.
- A wrong attendance record can be fixed by requesting a correction with a reason; HR approves or rejects it.
- Camera check-in (if enabled) needs exactly one face and the phone within ${s.radiusMeters} m of the office.
Leave
- Leave quotas: ${quotas}.
- Leave counts working days only; weekends and public holidays inside a leave are not deducted.
- A request that overlaps an existing leave, or is more than the remaining balance, is rejected.
- Leave is applied for by the employee and approved or rejected by HR with a comment. Pending leave is not deducted until approved. Nobody can approve their own request.
- An employee can cancel their own leave while it is pending, or after approval as long as it has not started yet.
- Public holidays this year: ${holidays.length ? holidays.map((x) => `${x.date} ${x.name}`).join("; ") : "none entered yet"}.
Payroll
- Gross salary = 1.5 × basic (basic + HRA 40% of basic + medical 10% of basic).
- Per-day pay = gross ÷ working days in the month. Deductions: absent days + unpaid leave days + 0.5 × half days.
- Joiners and leavers are paid pro rata for the days they were employed.
- Income tax (illustrative) is worked out on the month's earned pay (gross minus deductions) × 12, using these annual slabs: up to 600,000 = 0; 600,001–1,200,000 = 5% of the amount over 600,000; 1,200,001–2,400,000 = 30,000 + 15% over 1,200,000; 2,400,001–3,600,000 = 210,000 + 25% over 2,400,000; above 3,600,000 = 510,000 + 35% over 3,600,000. Monthly tax = annual tax ÷ 12. Net pay = gross − deductions − tax.
- HR prepares the monthly payroll draft; only Admin can finalize it, and a finalized month is locked.
Access
- Admin sees all company data. HR sees HR data. Employees see only their own records and can never see another employee's data or salary.`;
}

export function roleScopeText(actor: Session): string {
  switch (actor.role) {
    case "ADMIN":
      return "The user is an ADMIN and may see all company data.";
    case "HR":
      return "The user is HR and may see HR data for all employees (attendance, leave, payroll, directory).";
    default:
      return "The user is an EMPLOYEE. They may see only their own attendance, leave, balance and payslips. They must never get another employee's data, salary, attendance or leave, even partially, even if they insist or claim permission.";
  }
}

export function dateContext(): string {
  const today = todayIso();
  return `Today is ${weekdayName(today)}, ${today} (timezone ${APP_TZ}). "This month" means ${today.slice(0, 7)}-01 to ${today}.`;
}
