import { z } from "zod";
import {
  Agent,
  MaxTurnsExceededError,
  RunToolCallItem,
  RunToolCallOutputItem,
  assistant as assistantMessage,
  setTracingDisabled,
  tool as defineTool,
  user as userMessage,
  run as runWithAgents,
  type Model,
} from "@openai/agents";
import { setDefaultOpenAIClient, setOpenAIAPI } from "@openai/agents";
import OpenAI from "openai";
import { db } from "@/lib/db";
import type { Session } from "@/lib/session";
import type { AiRun } from "./guard";
import { buildPolicyText, dateContext, roleScopeText } from "./policy";
import { runTool, toolDefsFor } from "./tools";

const MAX_TOOL_ROUNDS = 4;
/** Upper bound on a single reply; keeps cost and latency predictable inside the 15 s budget (same as llm.ts). */
const MAX_COMPLETION_TOKENS = 800;
const NO_ANSWER_FALLBACK = "Sorry, I could not find an answer to that.";

function failToolContent(error: string, message: string): string {
  return JSON.stringify({ error, message });
}

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

// The OpenAI Agents SDK drives the tool loop; runTool keeps the role-scoped
// permission checks and the same services the REST API calls.

let sdkConfigured = false;
function configureAgentsSdk(): void {
  if (sdkConfigured) return;
  sdkConfigured = true;
  // Tracing would export spans to OpenAI; the guard's AbortSignal already bounds latency.
  setTracingDisabled(true);
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) return;
  setDefaultOpenAIClient(new OpenAI({ apiKey, maxRetries: 0, baseURL: process.env.AI_BASE_URL || undefined }));
  // Chat completions works with any OpenAI-compatible provider via AI_BASE_URL (same as llm.ts).
  setOpenAIAPI("chat_completions");
}

/** Tests inject a scripted Model here so runs never touch a provider. */
let injectedModel: Model | null = null;
export function setChatModel(model: Model | null): void {
  injectedModel = model;
}

function modelForRun(): string | Model {
  if (injectedModel) return injectedModel;
  if (!process.env.AI_API_KEY) throw new Error("AI_API_KEY is not set");
  return process.env.AI_MODEL || "gpt-4.1-mini";
}

function modelLabel(agent: Agent): string {
  const m = agent.model;
  if (typeof m === "string") return m;
  // A Model instance injected for tests (or a custom provider) has no user-facing name.
  return "custom-model";
}

function agentToolsFor(actor: Session) {
  return toolDefsFor(actor.role).map((def) =>
    defineTool({
      name: def.name,
      description: def.description,
      // JSON schema straight from toolDefsFor; runTool validates arguments with the original zod schema.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parameters: def.parameters as any,
      strict: false,
      execute: async (args) => (await runTool(actor, def.name, JSON.stringify(args ?? {}))).content,
    }),
  );
}

export async function runChat(actor: Session, req: ChatRequest, signal: AbortSignal): Promise<AiRun<{ answer: string }>> {
  configureAgentsSdk();
  const agent = new Agent({
    name: "hcm-lite-assistant",
    instructions: await buildChatSystemPrompt(actor),
    model: modelForRun(),
    tools: agentToolsFor(actor),
    modelSettings: { maxTokens: MAX_COMPLETION_TOKENS },
  });
  // Only plain user/assistant text reaches the agent (chatRequestSchema filters system/tool messages).
  const history = req.messages.map((m) => (m.role === "user" ? userMessage(m.content) : assistantMessage(m.content)));

  let result;
  try {
    result = await runWithAgents(agent, history, {
      maxTurns: MAX_TOOL_ROUNDS + 1,
      signal,
      // A model inventing a tool it was not given gets the same refusal runTool would produce,
      // instead of an exception.
      toolNotFoundBehavior: "return_error_to_model",
      toolErrorFormatter: ({ kind }) =>
        kind === "tool_not_found" ? failToolContent("forbidden", "This information is not available to your role.") : undefined,
    });
  } catch (err) {
    if (err instanceof MaxTurnsExceededError) {
      // The model kept calling tools instead of answering: give the friendly fallback.
      return { data: { answer: NO_ANSWER_FALLBACK }, output: NO_ANSWER_FALLBACK, model: modelLabel(agent) };
    }
    throw err;
  }

  const toolCalls: { name: string; args: string; ok: boolean }[] = [];
  const openByCallId = new Map<string, { name: string; args: string; ok: boolean }>();
  for (const item of result.newItems) {
    if (item instanceof RunToolCallItem && item.rawItem.type === "function_call") {
      const entry = { name: item.rawItem.name, args: item.rawItem.arguments, ok: false };
      toolCalls.push(entry);
      openByCallId.set(item.rawItem.callId, entry);
    } else if (item instanceof RunToolCallOutputItem && item.rawItem.type === "function_call_result") {
      const entry = openByCallId.get(item.rawItem.callId);
      if (!entry) continue;
      // The tool output is the runTool JSON: an `error` field means the model saw a refusal.
      try {
        entry.ok = !("error" in JSON.parse(item.output as string));
      } catch {
        entry.ok = false;
      }
    }
  }

  const usage = { prompt: 0, completion: 0 };
  for (const r of result.rawResponses) {
    usage.prompt += r.usage?.inputTokens ?? 0;
    usage.completion += r.usage?.outputTokens ?? 0;
  }
  const model = modelLabel(agent);

  let answer = (result.finalOutput ?? "").trim() || NO_ANSWER_FALLBACK;
  // finishReason round-trips from models that report it (scripted tests, some providers).
  if (result.rawResponses[0]?.providerData?.finishReason === "length") {
    answer += "\n\n(This answer was cut short. Please ask a narrower question.)";
  }
  return { data: { answer }, output: answer, toolCalls, model, usage };
}
