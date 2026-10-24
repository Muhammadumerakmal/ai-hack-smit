import { readJson, withSession } from "@/lib/api";
import { forbidden } from "@/lib/errors";
import { guardedAiCall } from "@/server/ai/guard";
import { runSmartLeave, smartLeaveRequestSchema } from "@/server/ai/smart-leave";

export const maxDuration = 30;

// POST /api/ai/smart-leave  { text }  → a pre-filled draft. Nothing is saved.
export const POST = withSession(async (req, session) => {
  if (session.role === "ADMIN" || !session.employeeId) throw forbidden("Smart leave is for employees applying for their own leave.");
  const { text } = await readJson(req, smartLeaveRequestSchema);
  return guardedAiCall(session, "smart_leave", text, (signal) => runSmartLeave(session, text, signal));
});
