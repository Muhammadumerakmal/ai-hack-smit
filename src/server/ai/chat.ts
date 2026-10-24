import { z } from "zod";
import { Agent, RunToolCallItem, RunToolCallOutputItem, run } from "@openai/agents";
import { db } from "@/lib/db";
import type { Session } from "@/lib/session";
import { agentModel, MAX_COMPLETION_TOKENS, modelLabel, usageOf, type AiContext } from "./agents";
import { chatHistory } from "./chat-history";
import type { AiRun } from "./guard";
import { buildPolicyText, dateContext, roleScopeText } from "./policy";
import { TOOLS, toolFailure } from "./tools";

const MAX_TOOL_ROUNDS = 4;
const NO_ANSWER_FALLBACK = "Sorry, I could not find an answer to that.";
/** Earlier history items replayed to the model each turn, on top of the new question. */
export const HISTORY_ITEMS = 20;

/**
 * The browser sends only the new question. Earlier turns come from the server-side history
 * (chat-history.ts), so the client cannot inject assistant, system or tool messages.
 */
export const chatRequestSchema = z.object({
  /** omitted for a new conversation; the reply returns the id to send next time */
  conversationId: z.string().min(1).max(100).optional(),
  message: z.string().trim().min(1).max(2000),
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

export async function runChat(
  actor: Session,
  req: ChatRequest,
  signal: AbortSignal,
): Promise<AiRun<{ answer: string; conversationId: string }>> {
  const agent = new Agent<AiContext>({
    name: "hcm-lite-assistant",
    instructions: (rc) => buildChatSystemPrompt(rc.context.actor),
    model: agentModel(),
    // Each tool's isEnabled hides it from roles that may not call it.
    tools: TOOLS,
    modelSettings: { maxTokens: MAX_COMPLETION_TOKENS },
  });
  const session = await chatHistory().open(actor.userId, req.conversationId);

  const result = await run(agent, req.message, {
    context: { actor },
    session,
    // The session holds the whole conversation; the model sees only the most recent part of it.
    sessionInputCallback: (history, newItems) => [...history.slice(-HISTORY_ITEMS), ...newItems],
    maxTurns: MAX_TOOL_ROUNDS + 1,
    signal,
    // The model kept calling tools instead of answering: give the friendly fallback.
    errorHandlers: { maxTurns: () => ({ finalOutput: NO_ANSWER_FALLBACK, includeInHistory: true }) },
    // A call to a tool the role was not given (or one that does not exist) gets a refusal, not an exception.
    toolNotFoundBehavior: "return_error_to_model",
    toolErrorFormatter: ({ kind }) =>
      kind === "tool_not_found" ? toolFailure("forbidden", "This information is not available to your role.") : undefined,
  });

  // ai_logs keep each tool's name, arguments and whether it succeeded, never its result (salaries).
  const toolCalls: { name: string; args: string; ok: boolean }[] = [];
  const byCallId = new Map<string, { name: string; args: string; ok: boolean }>();
  for (const item of result.newItems) {
    if (item instanceof RunToolCallItem && item.rawItem.type === "function_call") {
      const entry = { name: item.rawItem.name, args: item.rawItem.arguments, ok: false };
      toolCalls.push(entry);
      byCallId.set(item.rawItem.callId, entry);
    } else if (item instanceof RunToolCallOutputItem && item.rawItem.type === "function_call_result") {
      const entry = byCallId.get(item.rawItem.callId);
      if (!entry) continue;
      // Tool output is JSON; an `error` field (toolFailure) means the model saw a refusal.
      try {
        entry.ok = !("error" in JSON.parse(item.output as string));
      } catch {
        entry.ok = false;
      }
    }
  }

  let answer = (result.finalOutput ?? "").trim() || NO_ANSWER_FALLBACK;
  // finishReason round-trips from models that report it (scripted tests, some providers).
  // The last response is the one that produced the answer; earlier ones were tool calls.
  if (result.rawResponses.at(-1)?.providerData?.finishReason === "length") {
    answer += "\n\n(This answer was cut short. Please ask a narrower question.)";
  }
  return {
    data: { answer, conversationId: await session.getSessionId() },
    output: answer,
    toolCalls,
    model: modelLabel(agent.model),
    usage: usageOf(result.state),
  };
}
