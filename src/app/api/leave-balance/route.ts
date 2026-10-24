import { searchParams, withSession, yearParam } from "@/lib/api";
import { getLeaveBalance } from "@/server/services/leave.service";

// GET /api/leave-balance?employeeId=&year=  (employee: own only)
export const GET = withSession(async (req, s) => {
  const q = searchParams(req);
  return getLeaveBalance(s, { employeeId: q.get("employeeId") || undefined, year: yearParam(q.get("year")) });
});
