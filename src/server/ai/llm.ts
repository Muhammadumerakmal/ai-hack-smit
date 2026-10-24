import OpenAI from "openai";

// A thin, provider-neutral shape so the rest of M8 (and the tests) never touch SDK types.

export interface ToolCall {
  id: string;
  name: string;
  /** raw JSON string from the model; validated before use */
  arguments: string;
}

export type LlmMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmRequest {
  messages: LlmMessage[];
  tools?: ToolDef[];
  /** ask for a single JSON object as the reply */
  json?: boolean;
  signal: AbortSignal;
}

export interface LlmResponse {
  content: string | null;
  toolCalls: ToolCall[];
  model: string;
  /** "stop" | "tool_calls" | "length" (cut off by the token limit) | … */
  finishReason?: string;
  usage?: { prompt: number; completion: number };
}

/** Upper bound on a single reply; keeps cost and latency predictable inside the 15 s budget. */
const MAX_COMPLETION_TOKENS = 800;

export interface LlmClient {
  complete(req: LlmRequest): Promise<LlmResponse>;
}

class OpenAiClient implements LlmClient {
  private client: OpenAI;
  private model: string;

  constructor() {
    const apiKey = process.env.AI_API_KEY;
    if (!apiKey) throw new Error("AI_API_KEY is not set");
    // maxRetries 0: the 15 s budget is enforced by the caller's AbortSignal, retries would blow it.
    this.client = new OpenAI({ apiKey, maxRetries: 0, baseURL: process.env.AI_BASE_URL || undefined });
    this.model = process.env.AI_MODEL || "gpt-4.1-mini";
  }

  /** Set when the configured model rejected `temperature` (reasoning models do); later calls skip it. */
  private noTemperature = false;

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const create = (withTemperature: boolean) =>
      this.client.chat.completions.create(
        {
          model: this.model,
          ...(withTemperature ? { temperature: 0.2 } : {}),
          max_completion_tokens: MAX_COMPLETION_TOKENS,
          messages: req.messages.map(toOpenAi),
          ...(req.tools?.length
            ? { tools: req.tools.map((t) => ({ type: "function" as const, function: t })), tool_choice: "auto" as const }
            : {}),
          ...(req.json ? { response_format: { type: "json_object" as const } } : {}),
        },
        { signal: req.signal },
      );

    let res;
    try {
      res = await create(!this.noTemperature);
    } catch (err) {
      // A 400 about `temperature` is a model capability issue, not a failed request: retry once without it.
      // Safe to repeat: chat completions have no side effects.
      if (this.noTemperature || (err as { status?: number }).status !== 400 || !/temperature/i.test(String((err as Error).message))) throw err;
      this.noTemperature = true;
      res = await create(false);
    }

    const choice = res.choices?.[0];
    const msg = choice?.message;
    return {
      content: msg?.content ?? null,
      toolCalls: (msg?.tool_calls ?? [])
        .filter((c) => c.type === "function")
        .map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments })),
      model: res.model,
      finishReason: choice?.finish_reason ?? undefined,
      usage: res.usage ? { prompt: res.usage.prompt_tokens, completion: res.usage.completion_tokens } : undefined,
    };
  }
}

function toOpenAi(m: LlmMessage): OpenAI.Chat.ChatCompletionMessageParam {
  switch (m.role) {
    case "tool":
      return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
    case "assistant":
      return {
        role: "assistant",
        content: m.content,
        ...(m.toolCalls?.length
          ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.arguments } })) }
          : {}),
      };
    default:
      return { role: m.role, content: m.content };
  }
}

let instance: LlmClient | null = null;

export function getLlm(): LlmClient {
  return (instance ??= new OpenAiClient());
}

/** Tests inject a scripted fake here. */
export function setLlm(client: LlmClient | null): void {
  instance = client;
}
