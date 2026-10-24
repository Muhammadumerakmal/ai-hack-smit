import { randomUUID } from "node:crypto";
import type { AgentInputItem, AgentOutputItem, Model, ModelRequest, ModelResponse, StreamEvent } from "@openai/agents";
import { Usage } from "@openai/agents";
import type { LlmResponse } from "@/server/ai/llm";

/**
 * A scripted Agents-SDK model. Steps use the same shape as the legacy ScriptedLlm
 * (Partial<LlmResponse>) so chat tests read like the smart-leave/summary tests.
 * The recorded requests follow the SDK ModelRequest shape.
 */
export class ScriptedModel implements Model {
  readonly requests: { systemInstructions?: string; input: AgentInputItem[]; tools: unknown[] }[] = [];
  constructor(private steps: ((req: ModelRequest) => Partial<LlmResponse> | Promise<Partial<LlmResponse>>)[]) {}

  async getResponse(req: ModelRequest): Promise<ModelResponse> {
    this.requests.push({ systemInstructions: req.systemInstructions, input: structuredClone(req.input ?? []) as AgentInputItem[], tools: structuredClone(req.tools) });
    const step = this.steps.shift();
    if (!step) throw new Error("ScriptedModel ran out of steps");
    return toModelResponse(await step(req));
  }

  async *getStreamedResponse(): AsyncIterable<StreamEvent> {
    throw new Error("ScriptedModel does not support streaming");
  }
}

function toModelResponse(res: Partial<LlmResponse>): ModelResponse {
  const output: AgentOutputItem[] = [];
  for (const call of res.toolCalls ?? []) {
    output.push({ type: "function_call", callId: call.id, name: call.name, arguments: call.arguments });
  }
  if (res.content) {
    output.push({ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: res.content }] });
  } else if (output.length === 0) {
    // No tools and no text: an empty assistant message is what a broken provider reply looks like.
    output.push({ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "" }] });
  }
  const prompt = res.usage?.prompt ?? 0;
  const completion = res.usage?.completion ?? 0;
  return {
    output,
    usage: new Usage({ requests: 1, inputTokens: prompt, outputTokens: completion, totalTokens: prompt + completion }),
    ...(res.finishReason ? { providerData: { finishReason: res.finishReason } } : {}),
  };
}

/** A chat request body: one question, in a fresh conversation unless an id is given. */
export const chatTurn = (message: string, conversationId: string = randomUUID()) => ({ conversationId, message });

export const say = (content: string) => () => ({ content });
export const json = (v: unknown) => say(JSON.stringify(v));
export const callTool = (name: string, args: object = {}) => () => ({ toolCalls: [{ id: `call_${name}`, name, arguments: JSON.stringify(args) }] });
export const callTools = (calls: { id: string; name: string; arguments?: object }[]) => () => ({
  toolCalls: calls.map((c) => ({ id: c.id, name: c.name, arguments: JSON.stringify(c.arguments ?? {}) })),
});

/** The text of every function_call_result in a recorded model input (the same JSON runTool returned). */
export function toolOutputTexts(input: unknown[]): string[] {
  return (input as Array<{ type: string; output: { type: string; text?: string } | string }>)
    .filter((i) => i.type === "function_call_result")
    .map((i) => {
      const out = i.output;
      if (typeof out === "string") return out;
      if (out?.type === "text") return out.text ?? "";
      return JSON.stringify(out);
    });
}

/** Same reply on every call: for route-level tests that hit chat more often than one scripted run. */
export function constantModel(content: string): Model {
  return {
    getResponse: async (): Promise<ModelResponse> => toModelResponse({ content }),
    async *getStreamedResponse(): AsyncIterable<StreamEvent> {
      throw new Error("constantModel does not support streaming");
    },
  };
}

/** A model that hangs until the guard's signal aborts (used by the timeout test). */
export function hangingModel(): Model {
  return {
    getResponse: (req: ModelRequest) => new Promise<ModelResponse>((_, reject) => req.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
    async *getStreamedResponse(): AsyncIterable<StreamEvent> {
      throw new Error("hangingModel does not support streaming");
    },
  };
}

/** A provider failure used by the error-mapping test. */
export function failingModel(status = 503): Model {
  return {
    getResponse: async () => {
      throw Object.assign(new Error(`${status} upstream`), { status });
    },
    async *getStreamedResponse(): AsyncIterable<StreamEvent> {
      throw new Error("failingModel does not support streaming");
    },
  };
}
