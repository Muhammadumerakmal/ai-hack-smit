import { withSession } from "@/lib/api";
import { deleteConversation, getConversation } from "@/server/ai/chat-session";

// GET /api/ai/conversations/:id → { id, title, messages: [{ role, content }] } (own conversations only, else 404)
export const GET = withSession<{ id: string }>(async (_req, session, { id }) => getConversation(session.userId, id));

// DELETE /api/ai/conversations/:id
export const DELETE = withSession<{ id: string }>(async (_req, session, { id }) => {
  await deleteConversation(session.userId, id);
  return { ok: true };
});
