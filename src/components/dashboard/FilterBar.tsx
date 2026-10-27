"use client";

import { useState } from "react";
import { cx, DIcon } from "./primitives";

export interface Filters {
  start: string;
  end: string;
  department: string;
}

const iso = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
export const todayIsoLocal = () => iso(new Date());

function shift(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Date-range presets first (the filter every reader reaches for), then department. */
export function presets(today = todayIsoLocal()) {
  return [
    { id: "month", label: "This month", start: `${today.slice(0, 7)}-01`, end: today },
    { id: "30", label: "Last 30 days", start: shift(today, -29), end: today },
    { id: "90", label: "Last 90 days", start: shift(today, -89), end: today },
    { id: "ytd", label: "Year to date", start: `${today.slice(0, 4)}-01-01`, end: today },
  ];
}

export const rangeLabel = (f: Pick<Filters, "start" | "end">) => {
  const fmt = (s: string, withYear: boolean) =>
    new Date(`${s}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
  return `${fmt(f.start, f.start.slice(0, 4) !== f.end.slice(0, 4))} – ${fmt(f.end, true)}`;
};

const control =
  "h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm shadow-sm shadow-zinc-900/5 outline-none transition-colors focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15 dark:border-zinc-700 dark:bg-zinc-900";

/**
 * One row of filters above everything it scopes. On phones it collapses to a summary + "Filters" button.
 * Presets apply immediately; custom dates apply with "Apply".
 */
export function FilterBar({
  applied,
  departments,
  onApply,
  busy,
}: {
  applied: Filters;
  departments: string[];
  onApply: (f: Filters) => void;
  busy?: boolean;
}) {
  const [draft, setDraft] = useState(applied);
  const [open, setOpen] = useState(false);
  const list = presets();
  const activePreset = list.find((p) => p.start === applied.start && p.end === applied.end)?.id;
  const dirty = draft.start !== applied.start || draft.end !== applied.end || draft.department !== applied.department;

  function apply(f: Filters) {
    setDraft(f);
    onApply(f);
    setOpen(false);
  }

  return (
    <div className="sticky top-16 z-[5] -mx-4 mb-6 border-b border-white/60 bg-white/55 px-4 py-3 backdrop-blur-xl backdrop-saturate-150 sm:-mx-6 sm:px-6 dark:border-white/5 dark:bg-zinc-950/45">
      {/* Phone summary row */}
      <div className="flex items-center justify-between gap-3 md:hidden">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{rangeLabel(applied)}</p>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{applied.department || "All departments"}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium dark:border-zinc-700 dark:bg-zinc-900"
        >
          <DIcon name="filter" />
          Filters
        </button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.start && draft.end && draft.start <= draft.end) apply(draft);
        }}
        className={cx("mt-3 flex-col gap-3 md:mt-0 md:flex md:flex-row md:flex-wrap md:items-end", open ? "flex" : "hidden")}
      >
        <div className="flex flex-wrap gap-1.5 md:mr-1 md:pb-0.5" role="group" aria-label="Date range presets">
          {list.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => apply({ ...draft, start: p.start, end: p.end })}
              aria-pressed={activePreset === p.id}
              className={cx(
                "h-9 rounded-full px-3 text-xs font-medium transition-colors",
                activePreset === p.id
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "bg-white text-zinc-600 ring-1 ring-inset ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-700 dark:hover:bg-zinc-800",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        {/* min-w-fit: when the dates and department don't fit beside the presets, the whole group drops to its own line */}
        <div className="grid grid-cols-2 gap-3 md:flex md:min-w-fit md:flex-1 md:flex-wrap md:items-end">
          <label className="block space-y-1 md:w-40">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">From</span>
            <input type="date" className={control} value={draft.start} max={draft.end} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
          </label>
          <label className="block space-y-1 md:w-40">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">To</span>
            <input type="date" className={control} value={draft.end} min={draft.start} onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
          </label>
          <label className="col-span-2 block space-y-1 md:w-52">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Department</span>
            <select className={control} value={draft.department} onChange={(e) => setDraft({ ...draft, department: e.target.value })}>
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={!dirty || busy}
            className="col-span-2 inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-teal-700 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50 md:col-span-1"
          >
            {busy && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
            Apply
          </button>
        </div>
      </form>
    </div>
  );
}
