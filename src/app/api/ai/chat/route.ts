import { readJson, withSession } from "@/lib/api";
import { chatRequestSchema, runChat } from "@/server/ai/chat";
import { guardedAiCall } from "@/server/ai/guard";

export const maxDuration = 30;

// POST /api/ai/chat  { conversationId?: uuid, message }  → { ok, data: { answer, conversationId } }
// A first message without a conversationId creates one; earlier turns are read from the
// server-side history of that conversation.
export const POST = withSession(async (req, session) => {
  const body = await readJson(req, chatRequestSchema);
  return guardedAiCall(session, "chat", body.message, (signal) => runChat(session, body, signal));
});
