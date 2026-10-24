import { readJson, withSession } from "@/lib/api";
import { decideLeave, leaveDecisionSchema } from "@/server/services/leave.service";

// POST /api/leave-requests/:id/decision { decision: "APPROVED" | "REJECTED", comment }  (HR only)
export const POST = withSession<{ id: string }>(
  async (req, s, { id }) => ({ ok: true, ...(await decideLeave(s, id, await readJson(req, leaveDecisionSchema))) }),
  { roles: ["HR"] },
);
