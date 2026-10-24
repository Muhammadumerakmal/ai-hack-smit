import { z } from "zod";
import { Agent, defineOutputGuardrail, ModelBehaviorError, OutputGuardrailTripwireTriggered, run } from "@openai/agents";
import { isIsoDate, todayIso } from "@/lib/dates";
import { assertRole, type Session } from "@/lib/session";
import { getDashboardKpis } from "../services/analytics.service";
import { agentModel, MAX_COMPLETION_TOKENS, modelLabel, usageOf } from "./agents";
import type { AiRun } from "./guard";

export const summaryRequestSchema = z.object({
  start: z.string().refine(isIsoDate, "start must be YYYY-MM-DD").optional(),
  end: z.string().refine(isIsoDate, "end must be YYYY-MM-DD").optional(),
  department: z.string().max(80).optional(),
});

/** Structured output: the SDK sends this as the response JSON schema and parses the reply with it. */
const bulletsSchema = z.object({ bullets: z.array(z.string()).min(3).max(5) });

/** Every number that appears in the KPI JSON (values, numbers inside strings, array lengths). */
export function allowedNumbers(value: unknown, out = new Set<number>()): Set<number> {
  if (typeof value === "number") {
    out.add(value);
    out.add(Math.round(value));
  } else if (typeof value === "string") {
    for (const n of extractNumbers(value)) out.add(n);
  } else if (Array.isArray(value)) {
    out.add(value.length);
    value.forEach((v) => allowedNumbers(v, out));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((v) => allowedNumbers(v, out));
  }
  return out;
}

export function extractNumbers(text: string): number[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => Number(n.replace(/,/g, ""))).filter((n) => !Number.isNaN(n));
}

/** Numbers in the bullets that cannot be found in the KPI JSON, i.e. made up or computed by the model. */
export function ungroundedNumbers(bullets: string[], allowed: Set<number>): number[] {
  return bullets.flatMap(extractNumbers).filter((n) => !allowed.has(n));
}

export interface SummaryData {
  bullets: string[];
  kpis: Awaited<ReturnType<typeof getDashboardKpis>>;
}

export async function runSummary(
  actor: Session,
  filters: z.infer<typeof summaryRequestSchema>,
  signal: AbortSignal,
): Promise<AiRun<SummaryData>> {
  assertRole(actor, "ADMIN", "HR");
  const today = todayIso();
  const f = { start: filters.start ?? `${today.slice(0, 7)}-01`, end: filters.end ?? today, department: filters.department };
  const kpis = await getDashboardKpis(actor, f);
  const allowed = allowedNumbers(kpis);

  const model = agentModel();
  const agent = new Agent({
    name: "dashboard-summary",
    instructions: `You write the insight box of an HR dashboard: 3 to 5 bullets.
Use ONLY the numbers in the KPI JSON, copied exactly. Do not add, subtract, average or round them yourself, and do not invent trends or causes.
Each bullet: one short sentence that points out something useful (highest or lowest department, who is late most, pending approvals, leave use). If there is little data, say so plainly.`,
    model,
    outputType: bulletsSchema,
    modelSettings: { maxTokens: MAX_COMPLETION_TOKENS },
    outputGuardrails: [
      defineOutputGuardrail<typeof bulletsSchema>({
        name: "grounded_numbers",
        execute: async ({ agentOutput }) => {
          const ungrounded = [...new Set(ungroundedNumbers(agentOutput.bullets, allowed))];
          return { tripwireTriggered: ungrounded.length > 0, outputInfo: { ungrounded } };
        },
      }),
    ],
  });

  try {
    const result = await run(agent, `KPI JSON:\n${JSON.stringify(kpis)}`, { signal });
    const bullets = result.finalOutput!.bullets;
    return { data: { bullets, kpis }, output: bullets.join("\n"), model: modelLabel(model), usage: usageOf(result.state) };
  } catch (err) {
    // A reply that is not the schema, or that uses numbers missing from the KPI JSON: the dashboard shows the KPIs without bullets.
    if (err instanceof OutputGuardrailTripwireTriggered || err instanceof ModelBehaviorError) {
      const why =
        err instanceof OutputGuardrailTripwireTriggered
          ? `these numbers are not in the KPI JSON: ${(err.result.output.outputInfo as { ungrounded: number[] }).ungrounded.join(", ")}`
          : err.message;
      return { data: { bullets: [], kpis }, output: `invalid: ${why}`, status: "invalid_output", model: modelLabel(model), usage: usageOf(err.state) };
    }
    throw err;
  }
}
