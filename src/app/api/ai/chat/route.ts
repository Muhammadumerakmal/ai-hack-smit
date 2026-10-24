import { readJson, withSession } from "@/lib/api";
import { chatRequestSchema, runChat } from "@/server/ai/chat";
import { guardedAiCall } from "@/server/ai/guard";

export const maxDuration = 30;

// POST /api/ai/chat  { messages: [{ role: "user" | "assistant", content }] }
export const POST = withSession(async (req, session) => {
  const body = await readJson(req, chatRequestSchema);
  const question = body.messages[body.messages.length - 1].content;
  return guardedAiCall(session, "chat", question, (signal) => runChat(session, body, signal));
});
