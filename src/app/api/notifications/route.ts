import { withSession } from "@/lib/api";
import { listNotifications } from "@/server/services/comms.service";

// GET /api/notifications → { unread, items } (own, latest 20)
export const GET = withSession(async (_req, s) => listNotifications(s));
