import { withSession } from "@/lib/api";
import { checkOut } from "@/server/services/attendance.service";

// POST /api/attendance/check-out → under the half-day hours the day becomes HALF_DAY.
export const POST = withSession(async (_req, s) => ({ ok: true, record: await checkOut(s) }), { roles: ["HR", "EMPLOYEE"] });
