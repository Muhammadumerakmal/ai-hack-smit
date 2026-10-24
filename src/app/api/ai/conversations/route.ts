import { withSession } from "@/lib/api";
import { listConversations } from "@/server/ai/chat-session";

// GET /api/ai/conversations → the signed-in user's own recent assistant conversations
export const GET = withSession(async (_req, session) => listConversations(session.userId));
