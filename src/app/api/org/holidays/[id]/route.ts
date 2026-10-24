import { withSession } from "@/lib/api";
import { deleteHoliday } from "@/server/services/org.service";

// DELETE (Admin)
export const DELETE = withSession<{ id: string }>(async (_req, s, { id }) => {
  await deleteHoliday(s, id);
  return { ok: true };
}, { roles: ["ADMIN"] });
