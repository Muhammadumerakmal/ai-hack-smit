import { searchParams, withSession } from "@/lib/api";
import { getLeaveBalance } from "@/server/services/leave.service";

// GET /api/leave-balance?employeeId=&year=  (employee: own only)
export const GET = withSession(async (req, s) => {
  const q = searchParams(req);
  const year = q.get("year") ? Number(q.get("year")) : undefined;
  return getLeaveBalance(s, { employeeId: q.get("employeeId") || undefined, year: Number.isInteger(year) ? year : undefined });
});
