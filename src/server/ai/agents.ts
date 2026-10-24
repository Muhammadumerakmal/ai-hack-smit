import OpenAI from "openai";
import { setDefaultOpenAIClient, setTracingDisabled, type Model, type Usage } from "@openai/agents";
import type { Session } from "@/lib/session";

// One place that configures the OpenAI Agents SDK for every AI feature (chat, summary, smart leave).

/** The run context every agent and tool receives: tools read the signed-in user from here. */
export interface AiContext {
  actor: Session;
}

/** Upper bound on a single reply; keeps cost and latency predictable inside the 15 s budget. */
export const MAX_COMPLETION_TOKENS = 800;

let client: OpenAI | null = null;

/** The shared OpenAI client (also used for the hosted chat history). Throws when no key is configured. */
export function openAiClient(): OpenAI {
  if (client) return client;
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) throw new Error("AI_API_KEY is not set");
  // maxRetries 0: the 15 s budget is enforced by the guard's AbortSignal, retries would blow it.
  client = new OpenAI({ apiKey, maxRetries: 0, baseURL: process.env.AI_BASE_URL || undefined });
  // Tracing would export spans (with HR data) to OpenAI.
  setTracingDisabled(true);
  setDefaultOpenAIClient(client);
  return client;
}

/** Tests inject a scripted Model here so runs never touch a provider. */
let injectedModel: Model | null = null;
export function setAgentModel(model: Model | null): void {
  injectedModel = model;
}

/** The model for a new Agent: the injected one in tests, otherwise AI_MODEL through the SDK's OpenAI provider. */
export function agentModel(): string | Model {
  if (injectedModel) {
    setTracingDisabled(true);
    return injectedModel;
  }
  openAiClient();
  return process.env.AI_MODEL || "gpt-4.1-mini";
}

/** A user-facing model name for ai_logs (an injected test model has none). */
export function modelLabel(model: string | Model): string {
  return typeof model === "string" ? model : "custom-model";
}

/** Token usage the SDK aggregated over every model call of a run (result.state, or error.state on failure). */
export function usageOf(state: { usage: Usage } | undefined) {
  return { prompt: state?.usage.inputTokens ?? 0, completion: state?.usage.outputTokens ?? 0 };
}
