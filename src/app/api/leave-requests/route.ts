import { z } from "zod";
import { readJson, searchParams, withSession } from "@/lib/api";
import { isIsoDate } from "@/lib/dates";
import { applyForLeave, listLeaveRequests } from "@/server/services/leave.service";

const applySchema = z.object({
  type: z.string().min(1).max(40),
  start: z.string().refine(isIsoDate, "start must be YYYY-MM-DD"),
  end: z.string().refine(isIsoDate, "end must be YYYY-MM-DD"),
  reason: z.string().trim().min(1).max(300),
});

// GET /api/leave-requests?status=&mine=1  (employee: own; HR/Admin: all)
export const GET = withSession(async (req, s) => {
  const q = searchParams(req);
  return listLeaveRequests(s, { status: q.get("status") || undefined, mine: q.get("mine") === "1" });
});

// POST /api/leave-requests { type, start, end, reason } → 200 PENDING | 422 overlap / balance / no working days
export const POST = withSession(async (req, s) => {
  const draft = await readJson(req, applySchema);
  return { ok: true, request: await applyForLeave(s, draft) };
});
