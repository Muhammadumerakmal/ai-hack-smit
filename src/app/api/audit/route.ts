import { searchParams, withSession } from "@/lib/api";
import { listAuditLog } from "@/server/services/comms.service";

// GET /api/audit?entity=&action=&page= (Admin only). Append-only: there is deliberately no PUT/PATCH/DELETE.
export const GET = withSession(
  async (req, s) => {
    const q = searchParams(req);
    return listAuditLog(s, {
      entity: q.get("entity") || undefined,
      action: q.get("action") || undefined,
      page: Number(q.get("page") ?? 1) || 1,
      pageSize: Number(q.get("pageSize") ?? 25) || 25,
    });
  },
  { roles: ["ADMIN"] },
);
