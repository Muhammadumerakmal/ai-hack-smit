"use client";

import { useEffect, useState } from "react";
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
  leaveTypes: LeaveType[];
  draft: LeaveFormValues | null;
  preview: Preview | null;
  clarify: string | null;
}

const DEFAULT_TYPES: LeaveType[] = [
  { code: "annual", name: "Annual" },
  { code: "sick", name: "Sick" },
  { code: "casual", name: "Casual" },
  { code: "unpaid", name: "Unpaid" },
];
const EMPTY: LeaveFormValues = { type: "", start: "", end: "", reason: "" };

/**
 * Smart leave: sentence → AI draft → the normal leave form, pre-filled.
 * The AI never submits. `onSubmit` is M5's apply call (POST /api/leave-requests by default),
 * which runs the real overlap / balance / holiday checks.
 */
export function SmartLeaveForm({
  leaveTypes: initialTypes = DEFAULT_TYPES,
  onSubmit = defaultSubmit,
}: {
  leaveTypes?: LeaveType[];
  onSubmit?: (v: LeaveFormValues) => Promise<{ ok: boolean; message: string }>;
}) {
  const [text, setText] = useState("");
  const [types, setTypes] = useState(initialTypes);
  const [form, setForm] = useState<LeaveFormValues>(EMPTY);
  const [aiFilled, setAiFilled] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [notice, setNotice] = useState<{ tone: "info" | "warn" | "ok"; text: string } | null>(null);
  const [busy, setBusy] = useState<"ai" | "submit" | null>(null);
  const [question, setQuestion] = useState<string | null>(null);

  // Real leave types from Settings, so the manual form is right even when the AI is unavailable.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/org/leave-types", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { items?: LeaveType[] } | null) => {
        if (!cancelled && d?.items?.length) setTypes(d.items.map((t) => ({ code: t.code, name: t.name })));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function fillFromText() {
    if (text.trim().length < 3) return;
    setBusy("ai");
    setNotice(null);
    setQuestion(null);
    const res = await postAi<SmartLeaveData>("smart-leave", { text });
    setBusy(null);

    if (res.data?.leaveTypes?.length) setTypes(res.data.leaveTypes);
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
    if (res.ok) {
      setForm(EMPTY);
      setText("");
      setPreview(null);
      setAiFilled(false);
    }
  }

  const set = (k: keyof LeaveFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setPreview(null); // edited by hand: the AI preview no longer applies
  };

  const field = "w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-violet-500 dark:border-zinc-700";

  return (
    <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="space-y-2">
        <label htmlFor="smart-leave-text" className="text-sm font-semibold">
          Describe your leave
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="smart-leave-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), fillFromText())}
            maxLength={500}
            placeholder="e.g. I need next Monday and Tuesday off for my sister's wedding"
            className={field}
          />
          <button
            type="button"
            onClick={fillFromText}
            disabled={busy !== null || text.trim().length < 3}
            className="shrink-0 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {busy === "ai" ? "Reading…" : "✦ Fill the form"}
          </button>
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

      {notice && (
        <p
          role="status"
          className={`rounded-lg px-3 py-2 text-sm ${
            notice.tone === "ok"
              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
              : notice.tone === "warn"
                ? "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                : "bg-violet-50 text-violet-900 dark:bg-violet-950 dark:text-violet-200"
          }`}
        >
          {notice.text}
        </p>
      )}

      <form onSubmit={confirm} className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Leave request</h3>
          {aiFilled && <AiBadge />}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
            Type
            <select required value={form.type} onChange={set("type")} className={field}>
              <option value="">Select…</option>
              {types.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
            From
            <input required type="date" value={form.start} onChange={set("start")} className={field} />
          </label>
          <label className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
            To
            <input required type="date" min={form.start} value={form.end} onChange={set("end")} className={field} />
          </label>
        </div>
        <label className="block space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
          Reason
          <input required value={form.reason} onChange={set("reason")} maxLength={300} className={field} />
        </label>

        {preview && (
          <div className="space-y-1 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
            <p>
              {preview.workingDays} working day{preview.workingDays === 1 ? "" : "s"}
              {preview.remainingAfter != null && ` · ${preview.remainingAfter} left after this`}
            </p>
            {preview.notes.map((n) => (
              <p key={n}>{n}</p>
            ))}
            {preview.blocking.map((b) => (
              <p key={b} className="font-medium text-red-700 dark:text-red-400">
                {b}
              </p>
            ))}
          </div>
        )}

        <button
          type="submit"
          disabled={busy !== null || !!preview?.blocking.length}
          className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40 sm:w-auto"
        >
          {busy === "submit" ? "Submitting…" : "Confirm and apply"}
        </button>
      </form>
    </section>
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
