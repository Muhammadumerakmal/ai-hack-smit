import { withSession } from "@/lib/api";
import { checkIn } from "@/server/services/attendance.service";

// POST /api/attendance/check-in → the server stamps the time. Second check-in the same day = 409.
export const POST = withSession(async (_req, s) => ({ ok: true, record: await checkIn(s) }), { roles: ["HR", "EMPLOYEE"] });
