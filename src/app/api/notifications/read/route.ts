import { readJson, withSession } from "@/lib/api";
import { markNotificationsRead, markReadSchema } from "@/server/services/comms.service";

// POST /api/notifications/read { ids? } → marks the caller's own notifications read (all when ids is omitted)
export const POST = withSession(async (req, s) => {
  const { ids } = await readJson(req, markReadSchema);
  return markNotificationsRead(s, ids);
});
