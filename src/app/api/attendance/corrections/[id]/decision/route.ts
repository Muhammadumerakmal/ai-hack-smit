import { readJson, withSession } from "@/lib/api";
import { correctionDecisionSchema, decideCorrection } from "@/server/services/attendance.service";

// POST /api/attendance/corrections/:id/decision { approve, comment }  (HR only; comment required to reject)
export const POST = withSession<{ id: string }>(
  async (req, s, { id }) => ({ ok: true, ...(await decideCorrection(s, id, await readJson(req, correctionDecisionSchema))) }),
  { roles: ["HR"] },
);
