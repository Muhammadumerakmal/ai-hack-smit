import { withSession } from "@/lib/api";
import { getToday } from "@/server/services/attendance.service";

// GET /api/attendance/today → own record for today + office hours (check-in widget)
export const GET = withSession(async (_req, s) => getToday(s), { roles: ["HR", "EMPLOYEE"] });
