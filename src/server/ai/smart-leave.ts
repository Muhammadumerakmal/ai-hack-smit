import { z } from "zod";
import { addDays, isIsoDate, todayIso, weekdayName } from "@/lib/dates";
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
}

/**
 * Plain words → {type, start, end, reason}. Nothing is saved here: the response pre-fills
 * the normal leave form and the employee confirms it through M5's apply endpoint.
 */
export async function runSmartLeave(actor: Session, text: string, signal: AbortSignal): Promise<AiRun<SmartLeaveData>> {
  if (actor.role === "ADMIN" || !actor.employeeId) throw forbidden("Smart leave is for employees applying for their own leave.");

  const types = await getLeaveTypes();
  const codes = types.map((t) => t.code);
  const today = todayIso();

  // The model maps "next Monday" against this explicit calendar instead of doing date maths itself.
  const calendar = Array.from({ length: CALENDAR_DAYS }, (_, i) => {
    const d = addDays(today, i);
    return `${d} ${weekdayName(d)}${i === 0 ? " (today)" : ""}`;
  }).join("\n");

  const schema = z.object({
    type: z.enum(codes.length ? (codes as [string, ...string[]]) : ["casual"]),
    start: z.string().refine(isIsoDate, "must be YYYY-MM-DD"),
    end: z.string().refine(isIsoDate, "must be YYYY-MM-DD"),
    reason: z.string().trim().min(1).max(300),
  });

  const attempt = await completeJson(
    [
      {
        role: "system",
        content: `Turn an employee's leave request into JSON: {"type": string, "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "reason": string}.
Leave types: ${types.map((t) => `"${t.code}" = ${t.name}`).join(", ") || '"casual"'}.
Choosing the type: illness, doctor, medical → sick. Vacation, trip, travel, holiday → annual. Wedding, family event, personal errand, emergency or anything else → casual. Use unpaid only if the user says unpaid.
Dates: use the calendar below. "Next <weekday>" means the first such weekday after today. A single day has start = end. "Monday and Tuesday" means start = that Monday, end = the following Tuesday.
Reason: a short phrase in the user's words, e.g. "Sister's wedding". The user may write in English, Urdu or Roman Urdu.
Calendar:
${calendar}`,
      },
      { role: "user", content: text },
    ],
    schema,
    signal,
    (v) => {
      const errs: string[] = [];
      if (v.end < v.start) errs.push("end is before start");
      if (v.start < today) errs.push(`start ${v.start} is in the past (today is ${today})`);
      if (v.end > addDays(today, 365)) errs.push("end is more than a year away");
      return errs;
    },
  );

  const leaveTypes = types.map((t) => ({ code: t.code, name: t.name }));

  if (!attempt.ok) {
    return {
      data: { leaveTypes, draft: null, preview: null },
      output: `invalid: ${attempt.errors.join("; ")} | raw: ${attempt.raw}`,
      status: "invalid_output",
      model: attempt.model,
      usage: attempt.usage,
    };
  }

  const draft = attempt.value;
  return {
    data: { leaveTypes, draft, preview: await previewLeave(actor, draft) },
    output: JSON.stringify(draft),
    model: attempt.model,
    usage: attempt.usage,
  };
}
