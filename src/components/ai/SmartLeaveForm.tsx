"use client";

import { useState } from "react";
import { OpsIcon } from "@/components/ops/icons";
import { cx, Panel } from "@/components/ops/primitives";
import { Button, Field, Input, Notice, Select } from "@/components/ui";
import { AiBadge } from "./AiBadge";
import { postAi } from "./api";

interface LeaveType {
  code: string;
  name: string;
}
export interface LeaveFormValues {
  type: string;
  start: string;
  end: string;
  reason: string;
}
interface Preview {
  workingDays: number;
  remainingAfter: number | null;
  blocking: string[];
  notes: string[];
}
interface SmartLeaveData {
  draft: LeaveFormValues | null;
  preview: Preview | null;
  clarify: string | null;
}

const EMPTY: LeaveFormValues = { type: "", start: "", end: "", reason: "" };

// Clicking one only fills the sentence box; the user still presses "Fill the form", checks, and confirms.
const EXAMPLES = ["Next Monday and Tuesday off for my sister's wedding", "I'm sick today", "3 days annual leave from the 1st of next month"];

/**
 * Smart leave: sentence → AI draft → the normal leave form, pre-filled.
 * The AI never submits. `onSubmit` is M5's apply call (POST /api/leave-requests by default),
 * which runs the real overlap / balance / holiday checks.
 */
export function SmartLeaveForm({
  leaveTypes,
  leaveTypesLoading = false,
  onSubmit = defaultSubmit,
}: {
  leaveTypes: LeaveType[];
  leaveTypesLoading?: boolean;
  onSubmit?: (v: LeaveFormValues) => Promise<{ ok: boolean; message: string }>;
}) {
  const [text, setText] = useState("");
  const [form, setForm] = useState<LeaveFormValues>(EMPTY);
  const [aiFilled, setAiFilled] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [notice, setNotice] = useState<{ tone: "info" | "warn" | "ok"; text: string } | null>(null);
  const [busy, setBusy] = useState<"ai" | "submit" | null>(null);
  const [question, setQuestion] = useState<string | null>(null);

  async function fillFromText() {
    if (text.trim().length < 3 || !leaveTypes.length) return;
    setBusy("ai");
    setNotice(null);
    setQuestion(null);
    const res = await postAi<SmartLeaveData>("smart-leave", { text });
    setBusy(null);

    if (res.ok && res.data.clarify) {
      // The assistant needs more detail: ask, keep the form as it was, let the user rephrase.
      setQuestion(res.data.clarify);
    } else if (res.ok && res.data.draft) {
      setForm(res.data.draft);
      setPreview(res.data.preview);
      setAiFilled(true);
      setNotice({ tone: "info", text: "Check the details below, then confirm. Nothing has been submitted yet." });
    } else {
      // Fallback: the normal, empty form.
      setAiFilled(false);
      setPreview(null);
      setNotice({ tone: "warn", text: `${res.ok ? "Could not understand the dates." : res.message} Please fill in the form yourself.` });
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy("submit");
    const res = await onSubmit(form);
    setBusy(null);
    setNotice({ tone: res.ok ? "ok" : "warn", text: res.message });
    if (res.ok) reset(false);
  }

  function reset(clearNotice = true) {
    setForm(EMPTY);
    setText("");
    setPreview(null);
    setAiFilled(false);
    setQuestion(null);
    if (clearNotice) setNotice(null);
  }

  const set = (k: keyof LeaveFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setPreview(null); // edited by hand: the AI preview no longer applies
  };

  const noTypes = !leaveTypesLoading && !leaveTypes.length;
  const dirty = !!(form.type || form.start || form.end || form.reason || text);

  return (
    <Panel icon="calendar" title="Request leave" subtitle="Describe it in plain words and the assistant fills in the form for you to check. Nothing is sent until you confirm.">
      <div className="space-y-5">
        <div className="rounded-xl bg-gradient-to-br from-violet-50 to-white p-3 ring-1 ring-violet-200/70 sm:p-4 dark:from-violet-500/10 dark:to-transparent dark:ring-violet-400/20">
          <label htmlFor="smart-leave-text" className="mb-2 flex items-center gap-2 text-[13px] font-medium text-violet-900 dark:text-violet-200">
            <OpsIcon name="sparkle" className="h-4 w-4" /> Smart leave
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="smart-leave-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), fillFromText())}
              maxLength={500}
              placeholder="e.g. I need next Monday and Tuesday off for my sister's wedding"
            />
            <Button
              type="button"
              variant="ai"
              onClick={fillFromText}
              loading={busy === "ai"}
              disabled={busy !== null || text.trim().length < 3 || leaveTypesLoading || !leaveTypes.length}
              className="shrink-0"
            >
              {busy === "ai" ? "Reading…" : "Fill the form"}
            </Button>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setText(ex)}
                className="rounded-full bg-white px-2.5 py-1 text-xs text-violet-800 ring-1 ring-violet-200 transition-colors hover:bg-violet-100 dark:bg-zinc-900 dark:text-violet-200 dark:ring-violet-400/30 dark:hover:bg-violet-500/10"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>

        {question && (
          <div role="status" className="space-y-1 rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-900 dark:bg-violet-950 dark:text-violet-200">
            <p>{question}</p>
            <p className="flex items-center gap-2 text-xs text-violet-700 dark:text-violet-300">
              <AiBadge /> Add the details to your sentence above and press “Fill the form” again.
            </p>
          </div>
        )}

        {notice &&
          (notice.tone === "info" ? (
            <p role="status" className="flex items-center gap-2 rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-900 dark:bg-violet-950 dark:text-violet-200">
              <OpsIcon name="info" className="h-4 w-4 shrink-0" />
              {notice.text}
            </p>
          ) : (
            <Notice tone={notice.tone === "ok" ? "success" : "warn"}>{notice.text}</Notice>
          ))}

        {leaveTypesLoading && !leaveTypes.length && (
          <p role="status" className="text-sm text-zinc-500">
            Loading leave types…
          </p>
        )}
        {noTypes && <Notice tone="warn">No leave types are available. Ask an Admin to configure them in Company setup.</Notice>}

        <form onSubmit={confirm} className="space-y-4">
          <div className="flex items-center gap-3">
            <h3 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-zinc-500 dark:text-zinc-400">Leave request</h3>
            <span className="h-px flex-1 bg-zinc-100 dark:bg-zinc-800" aria-hidden />
            {aiFilled && <AiBadge />}
          </div>
          <div className={cx("grid gap-3 sm:grid-cols-3", aiFilled && "rounded-xl ring-2 ring-violet-200/60 ring-offset-4 ring-offset-white dark:ring-violet-400/20 dark:ring-offset-zinc-900")}>
            <Field label="Type">
              <Select required disabled={leaveTypesLoading || !leaveTypes.length} value={form.type} onChange={set("type")}>
                <option value="">Select…</option>
                {leaveTypes.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="From">
              <Input required type="date" value={form.start} onChange={set("start")} />
            </Field>
            <Field label="To">
              <Input required type="date" min={form.start} value={form.end} onChange={set("end")} />
            </Field>
          </div>
          <Field label="Reason" hint="HR sees this when deciding.">
            <Input required value={form.reason} onChange={set("reason")} maxLength={300} />
          </Field>

          {preview && (
            <div className="space-y-2 rounded-xl bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <p>
                  <span className="font-semibold tabular-nums">{preview.workingDays}</span> working day{preview.workingDays === 1 ? "" : "s"}
                </p>
                {preview.remainingAfter != null && (
                  <p>
                    <span className="font-semibold tabular-nums">{preview.remainingAfter}</span> left after this
                  </p>
                )}
              </div>
              {preview.notes.map((n) => (
                <p key={n} className="text-xs text-zinc-600 dark:text-zinc-400">
                  {n}
                </p>
              ))}
              {preview.blocking.map((b) => (
                <p key={b} className="flex items-start gap-1.5 text-[13px] font-medium text-red-700 dark:text-red-400">
                  <OpsIcon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
                  {b}
                </p>
              ))}
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            <Button type="submit" loading={busy === "submit"} disabled={busy !== null || !leaveTypes.length || !!preview?.blocking.length} className="sm:w-auto">
              <OpsIcon name="check" /> {busy === "submit" ? "Submitting…" : "Confirm and apply"}
            </Button>
            {dirty && (
              <Button type="button" variant="ghost" onClick={() => reset()} disabled={busy !== null}>
                Clear
              </Button>
            )}
          </div>
        </form>
      </div>
    </Panel>
  );
}

async function defaultSubmit(v: LeaveFormValues): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch("/api/leave-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(v),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, message: "Leave request sent to HR for approval." };
    return { ok: false, message: json.message ?? `Could not submit (error ${res.status}).` };
  } catch {
    return { ok: false, message: "Could not reach the server." };
  }
}
