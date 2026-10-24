import { readJson, withSession } from "@/lib/api";
import { assertRole } from "@/lib/session";
import { guardedAiCall } from "@/server/ai/guard";
import { runSummary, summaryRequestSchema } from "@/server/ai/summary";

export const maxDuration = 30;

// POST /api/ai/summary  { start?, end?, department? }  (the dashboard's current filters)
export const POST = withSession(async (req, session) => {
  assertRole(session, "ADMIN", "HR");
  const filters = await readJson(req, summaryRequestSchema);
  return guardedAiCall(session, "summary", JSON.stringify(filters), (signal) => runSummary(session, filters, signal));
});
