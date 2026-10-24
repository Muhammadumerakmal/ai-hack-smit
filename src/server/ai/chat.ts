import { z } from "zod";
import { db } from "@/lib/db";
import type { Session } from "@/lib/session";
import type { AiRun } from "./guard";
import { getLlm, type LlmMessage } from "./llm";
import { buildPolicyText, dateContext, roleScopeText } from "./policy";
import { runTool, toolDefsFor } from "./tools";

const MAX_TOOL_ROUNDS = 4;

/** Only plain user/assistant text is accepted from the browser; tool results are never trusted from the client. */
export const chatRequestSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(2000) }))
    .min(1)
    .max(20)
    // zod v4 runs refinements even when .min() already failed, so guard the empty array.
    .refine((m) => m.length > 0 && m[m.length - 1].role === "user", "The last message must be from the user"),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export async function buildChatSystemPrompt(actor: Session): Promise<string> {
  // Real department names, so the model filters by what exists instead of guessing ("HR", "Finance"…).
  const departments = (await db.department.findMany({ select: { name: true }, orderBy: { name: "asc" } })).map((d) => d.name);
  return `You are the HCM Lite assistant for HR questions.
${dateContext()}
User: ${actor.name ?? "unknown"} (role ${actor.role}). ${roleScopeText(actor)}
Departments: ${departments.length ? departments.join(", ") : "none created yet"}. Use these exact names in tool arguments; for "each department" questions, omit the department filter and read the per-department breakdown.

Rules:
1. For any number or fact about employees, attendance, leave or payroll, call a tool. Never guess, estimate or invent data. Quote numbers exactly as the tool returns them.
2. If a tool returns an error such as "forbidden", politely say the user does not have access to that information. Do not hint at the value.
3. If the user asks about another employee's salary, pay, attendance or leave and they are an EMPLOYEE, politely refuse without calling any tool.
4. For questions about rules (late time, quotas, payroll formula, tax), answer only from the COMPANY POLICY below. If the policy does not cover it, say you don't know and suggest asking HR.
5. You cannot create, change, approve or delete anything. If asked, explain which screen to use (e.g. the Leave page to apply for leave).
6. Reply in the language of the user's latest message (English unless they wrote in Urdu or Roman Urdu). Keep answers short: one to four sentences or a short list.

${await buildPolicyText()}`;
}

export async function runChat(actor: Session, req: ChatRequest, signal: AbortSignal): Promise<AiRun<{ answer: string }>> {
  const llm = getLlm();
  const tools = toolDefsFor(actor.role);
  const messages: LlmMessage[] = [{ role: "system", content: await buildChatSystemPrompt(actor) }, ...req.messages];
  const toolLog: { name: string; args: string; ok: boolean }[] = [];
  const usage = { prompt: 0, completion: 0 };
  let model: string | undefined;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    // On the last round, withhold tools so the model must answer with what it has.
    const res = await llm.complete({ messages, tools: round < MAX_TOOL_ROUNDS ? tools : undefined, signal });
    model = res.model;
    usage.prompt += res.usage?.prompt ?? 0;
    usage.completion += res.usage?.completion ?? 0;

    if (res.toolCalls.length === 0) {
      let answer = res.content?.trim() || "Sorry, I could not find an answer to that.";
      if (res.finishReason === "length") answer += "\n\n(This answer was cut short. Please ask a narrower question.)";
      return { data: { answer }, output: answer, toolCalls: toolLog, model, usage };
    }

    messages.push({ role: "assistant", content: res.content, toolCalls: res.toolCalls });
    for (const call of res.toolCalls) {
      const result = await runTool(actor, call.name, call.arguments);
      toolLog.push({ name: call.name, args: call.arguments, ok: result.ok });
      messages.push({ role: "tool", toolCallId: call.id, content: result.content });
    }
  }
  // Unreachable: the final round has no tools, so it always returns above.
  throw new Error("tool loop did not finish");
}
