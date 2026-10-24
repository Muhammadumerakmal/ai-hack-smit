import { searchParams, withSession } from "@/lib/api";
import { todayIso } from "@/lib/dates";
import { getBoard } from "@/server/services/attendance.service";

// GET /api/attendance/board?date=YYYY-MM-DD&department=  (Admin, HR)
export const GET = withSession(
  async (req, s) => {
    const q = searchParams(req);
    return getBoard(s, { date: q.get("date") || todayIso(), department: q.get("department") || undefined });
  },
  { roles: ["ADMIN", "HR"] },
);
