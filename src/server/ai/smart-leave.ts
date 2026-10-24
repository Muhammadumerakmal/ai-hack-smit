import { z } from "zod";
import { addDays, APP_TZ, isIsoDate, todayIso, weekdayName } from "@/lib/dates";
import { forbidden } from "@/lib/errors";
import type { Session } from "@/lib/session";
import { previewLeave, type LeaveDraft } from "../services/leave.service";
import { getLeaveTypes } from "../services/settings.service";
import type { AiRun } from "./guard";
import { completeJson } from "./json-output";

const CALENDAR_DAYS = 45;

export const smartLeaveRequestSchema = z.object({ text: z.string().trim().min(3).max(500) });

export interface SmartLeaveData {
  leaveTypes: { code: string; name: string }[];
  draft: LeaveDraft | null;
  preview: Awaited<ReturnType<typeof previewLeave>> | null;
  /** A question for the employee when the request is ambiguous or impossible (past dates, reversed range…). */
  clarify: string | null;
}

/**
 * Plain words → {type, start, end, reason}, or a clarifying question. Nothing is saved here:
 * a draft pre-fills the normal leave form, and the employee confirms it through POST /api/leave-requests,
 * which re-checks dates, overlap and balance on the server.
 */
export async function runSmartLeave(actor: Session, text: string, signal: AbortSignal): Promise<AiRun<SmartLeaveData>> {
  if (actor.role === "ADMIN" || !actor.employeeId) throw forbidden("Smart leave is for employees applying for their own leave.");

  const types = await getLeaveTypes();
  const codes = types.map((t) => t.code);
  const today = todayIso(); // company timezone (APP_TZ)

  // The model maps "next Monday" against this explicit calendar instead of doing date maths itself.
  const calendar = Array.from({ length: CALENDAR_DAYS }, (_, i) => {
    const d = addDays(today, i);
    return `${d} ${weekdayName(d)}${i === 0 ? " (today)" : ""}`;
  }).join("\n");

  const draftSchema = z.object({
    type: z.enum(codes.length ? (codes as [string, ...string[]]) : ["casual"]),
    start: z.string().refine(isIsoDate, "must be YYYY-MM-DD"),
    end: z.string().refine(isIsoDate, "must be YYYY-MM-DD"),
    reason: z.string().trim().min(1).max(300),
  });
  const clarifySchema = z.object({ clarify: z.string().trim().min(5).max(300) }).strict();
  const schema = z.union([clarifySchema, draftSchema]);

  const attempt = await completeJson(
    [
      {
        role: "system",
        content: `Turn an employee's leave request into ONE JSON object, either
  a draft: {"type": string, "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "reason": string}
  or a question: {"clarify": "<one short question for the employee>"}.
Leave types: ${types.map((t) => `"${t.code}" = ${t.name}`).join(", ") || '"casual"'}.
Choosing the type: illness, doctor, medical → sick. Vacation, trip, travel, holiday → annual. Wedding, family event, personal errand, emergency or anything else → casual. Use unpaid only if the user says unpaid.
Dates (timezone ${APP_TZ}, today is ${today}, ${weekdayName(today)}):
- Use the calendar below. "Next <weekday>" means the first such weekday after today. A single day has start = end. "Monday and Tuesday" means start = that Monday, end = the following Tuesday.
- A date written without a year (e.g. "12 November") means its next occurrence on or after today.
Ask instead of guessing: return {"clarify": …} when the exact days are unclear (e.g. "two days next week" without saying which), when the dates are in the past, or when the end date is before the start date.
Reason: a short phrase in the user's words, e.g. "Sister's wedding". The user may write in English, Urdu or Roman Urdu. Write the clarify question in the SAME language as the request: English requests get English questions; use Urdu or Roman Urdu only if the request itself is in it.
Calendar:
${calendar}`,
      },
      { role: "user", content: text },
    ],
    schema,
    signal,
    (v) => {
      if ("clarify" in v) return [];
      const errs: string[] = [];
      if (v.end < v.start) errs.push("end is before start — ask the employee which dates they meant");
      if (v.start < today) errs.push(`start ${v.start} is in the past (today is ${today}) — leave cannot be booked for past days; ask instead`);
      if (v.end > addDays(today, 365)) errs.push("end is more than a year away");
      return errs;
    },
  );

  const leaveTypes = types.map((t) => ({ code: t.code, name: t.name }));
  const base = { model: attempt.model, usage: attempt.usage };

  if (!attempt.ok) {
    return {
      data: { leaveTypes, draft: null, preview: null, clarify: null },
      output: `invalid: ${attempt.errors.join("; ")} | raw: ${attempt.raw}`.slice(0, 2000),
      status: "invalid_output",
      ...base,
    };
  }

  if ("clarify" in attempt.value) {
    return { data: { leaveTypes, draft: null, preview: null, clarify: attempt.value.clarify }, output: `clarify: ${attempt.value.clarify}`, ...base };
  }

  const draft = attempt.value;
  return {
    data: { leaveTypes, draft, preview: await previewLeave(actor, draft), clarify: null },
    output: JSON.stringify(draft),
    ...base,
  };
}
