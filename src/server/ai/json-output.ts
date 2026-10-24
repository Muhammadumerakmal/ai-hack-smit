import { z } from "zod";
import type { LlmMessage } from "./llm";
import { getLlm } from "./llm";

export type JsonAttempt<T> =
  | { ok: true; value: T; raw: string; model?: string; usage: { prompt: number; completion: number } }
  | { ok: false; errors: string[]; raw: string; model?: string; usage: { prompt: number; completion: number } };

/**
 * Ask for a JSON object, check it with a zod schema plus an optional business check,
 * and retry exactly once with the errors fed back. After that the caller shows the normal form.
 */
export async function completeJson<S extends z.ZodType>(
  messages: LlmMessage[],
  schema: S,
  signal: AbortSignal,
  check?: (value: z.infer<S>) => string[],
): Promise<JsonAttempt<z.infer<S>>> {
  const llm = getLlm();
  const convo = [...messages];
  const usage = { prompt: 0, completion: 0 };
  const errors: string[] = [];
  let raw = "";
  let model: string | undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await llm.complete({ messages: convo, json: true, signal });
    raw = res.content ?? "";
    model = res.model;
    usage.prompt += res.usage?.prompt ?? 0;
    usage.completion += res.usage?.completion ?? 0;

    const problems = validate(raw, schema, check);
    if (problems.ok) return { ok: true, value: problems.value, raw, model, usage };

    errors.push(...problems.errors);
    convo.push(
      { role: "assistant", content: raw },
      { role: "user", content: `That JSON is not valid: ${problems.errors.join("; ")}. Reply again with only the corrected JSON object.` },
    );
  }
  return { ok: false, errors, raw, model, usage };
}

function validate<S extends z.ZodType>(
  raw: string,
  schema: S,
  check?: (value: z.infer<S>) => string[],
): { ok: true; value: z.infer<S> } | { ok: false; errors: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ["the reply is not JSON"] };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "root"}: ${i.message}`) };
  const extra = check?.(parsed.data) ?? [];
  return extra.length ? { ok: false, errors: extra } : { ok: true, value: parsed.data };
}
