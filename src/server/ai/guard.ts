import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { currentCompanyId } from "@/lib/tenant";
import { HttpError, tooManyRequests, unauthorized } from "@/lib/errors";
import type { Session } from "@/lib/session";

export type AiFeature = "chat" | "summary" | "smart_leave";

export const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 15_000);
export const AI_RATE_LIMIT_PER_HOUR = Number(process.env.AI_RATE_LIMIT_PER_HOUR ?? 20);

export const FALLBACK_MESSAGE = {
  timeout: "The assistant took too long to answer. Please try again, or use the normal screens; all your data is there.",
  error: "The assistant is not available right now. Please try again in a moment, or use the normal screens.",
  invalid_output: "The assistant could not produce a reliable answer. Please use the normal form.",
} as const;

/** What a feature hands back to the guard: the payload for the client plus what to write in ai_logs. */
export interface AiRun<T> {
  data: T;
  output: string;
  status?: "ok" | "invalid_output";
  toolCalls?: unknown;
  model?: string;
  usage?: { prompt: number; completion: number };
}

export type AiResult<T> =
  | { ok: true; label: "AI-generated"; data: T }
  | { ok: false; reason: keyof typeof FALLBACK_MESSAGE; message: string; data?: T };

/** Counted from ai_logs so the limit holds across serverless instances. Rate-limited attempts don't count. */
export async function assertWithinRateLimit(userId: string, now = new Date()): Promise<void> {
  const since = new Date(now.getTime() - 60 * 60 * 1000);
  const used = await db.aiLog.count({ where: { userId, createdAt: { gte: since }, status: { not: "rate_limited" } } });
  if (used >= AI_RATE_LIMIT_PER_HOUR) {
    throw tooManyRequests(`You have used the assistant ${used} times in the last hour. Please try again later.`);
  }
}

async function log(actor: Session, feature: AiFeature, input: string, row: Partial<Prisma.AiLogUncheckedCreateInput>) {
  try {
    await db.aiLog.create({
      data: { companyId: currentCompanyId(), userId: actor.userId, role: actor.role, feature, input: input.slice(0, 4000), status: "ok", latencyMs: 0, ...row },
    });
  } catch (err) {
    // Never fail the user's request because the log write failed.
    console.error("[ai] failed to write ai_logs", err);
  }
}

/**
 * Wraps every AI feature: active-user check, rate limit, 15 s timeout, logging, friendly fallback.
 * HttpErrors (401/403/429/400) propagate to the route; provider failures become a fallback result.
 */
export async function guardedAiCall<T>(
  actor: Session,
  feature: AiFeature,
  input: string,
  fn: (signal: AbortSignal) => Promise<AiRun<T>>,
): Promise<AiResult<T>> {
  const user = await db.user.findUnique({ where: { id: actor.userId }, select: { isActive: true } });
  if (!user?.isActive) throw unauthorized("Your account is not active.");

  try {
    await assertWithinRateLimit(actor.userId);
  } catch (err) {
    if (err instanceof HttpError && err.status === 429) await log(actor, feature, input, { status: "rate_limited" });
    throw err;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  const started = Date.now();
  try {
    const run = await fn(controller.signal);
    const status = run.status ?? "ok";
    await log(actor, feature, input, {
      status,
      output: run.output.slice(0, 8000),
      toolCalls: (run.toolCalls ?? undefined) as Prisma.InputJsonValue | undefined,
      latencyMs: Date.now() - started,
      model: run.model,
      promptTokens: run.usage?.prompt,
      completionTokens: run.usage?.completion,
    });
    if (status === "invalid_output") {
      return { ok: false, reason: "invalid_output", message: FALLBACK_MESSAGE.invalid_output, data: run.data };
    }
    return { ok: true, label: "AI-generated", data: run.data };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const reason = controller.signal.aborted ? "timeout" : "error";
    console.error(`[ai] ${feature} ${reason}`, err);
    await log(actor, feature, input, { status: reason, output: String(err).slice(0, 1000), latencyMs: Date.now() - started });
    return { ok: false, reason, message: FALLBACK_MESSAGE[reason] };
  } finally {
    clearTimeout(timer);
  }
}
