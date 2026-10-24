import { withSession } from "@/lib/api";
import { cancelLeave } from "@/server/services/leave.service";

// POST /api/leave-requests/:id/cancel  (owner only; pending, or approved and not started)
export const POST = withSession<{ id: string }>(async (_req, s, { id }) => ({ ok: true, ...(await cancelLeave(s, id)) }));
