import { searchParams, withSession } from "@/lib/api";
import { currentMonth } from "@/lib/dates";
import { getCalendar } from "@/server/services/attendance.service";

// GET /api/attendance/calendar?month=YYYY-MM&employeeId=  (employees: own only)
export const GET = withSession(async (req, s) => {
  const q = searchParams(req);
  return getCalendar(s, { month: q.get("month") || currentMonth(), employeeId: q.get("employeeId") || undefined });
});
