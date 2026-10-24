import { z } from "zod";
import { isIsoDate, todayIso } from "@/lib/dates";
import { assertRole, type Session } from "@/lib/session";
import { getDashboardKpis } from "../services/analytics.service";
import type { AiRun } from "./guard";
import { completeJson } from "./json-output";

export const summaryRequestSchema = z.object({
  start: z.string().refine(isIsoDate, "start must be YYYY-MM-DD").optional(),
  end: z.string().refine(isIsoDate, "end must be YYYY-MM-DD").optional(),
  department: z.string().max(80).optional(),
});

const bulletsSchema = z.object({ bullets: z.array(z.string().trim().min(5).max(220)).min(3).max(5) });

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

  const attempt = await completeJson(
    [
      {
        role: "system",
        content: `You write the insight box of an HR dashboard. Reply as JSON: {"bullets": ["...", "..."]} with 3 to 5 bullets.
Use ONLY the numbers in the KPI JSON, copied exactly. Do not add, subtract, average or round them yourself, and do not invent trends or causes.
Each bullet: one short sentence that points out something useful (highest or lowest department, who is late most, pending approvals, leave use). If there is little data, say so plainly.`,
      },
      { role: "user", content: `KPI JSON:\n${JSON.stringify(kpis)}` },
    ],
    bulletsSchema,
    signal,
    (v) => {
      const bad = ungroundedNumbers(v.bullets, allowed);
      return bad.length ? [`these numbers are not in the KPI JSON: ${[...new Set(bad)].join(", ")}`] : [];
    },
  );

  if (!attempt.ok) {
    return {
      data: { bullets: [], kpis },
      output: `invalid: ${attempt.errors.join("; ")}`,
      status: "invalid_output",
      model: attempt.model,
      usage: attempt.usage,
    };
  }
  return {
    data: { bullets: attempt.value.bullets, kpis },
    output: attempt.value.bullets.join("\n"),
    model: attempt.model,
    usage: attempt.usage,
  };
}
