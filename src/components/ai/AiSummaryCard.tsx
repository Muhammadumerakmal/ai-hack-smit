"use client";

import { useState } from "react";
import { AiBadge } from "./AiBadge";
import { postAi } from "./api";

export interface DashboardFilters {
  start?: string;
  end?: string;
  department?: string;
}

/** Drop into the Admin / HR dashboard and pass the same filters the charts use. */
export function AiSummaryCard({ filters }: { filters: DashboardFilters }) {
  // Every result remembers the filters it was made for, so bullets never outlive a filter change.
  const key = JSON.stringify({ start: filters.start ?? "", end: filters.end ?? "", department: filters.department ?? "" });
  const [result, setResult] = useState<
    { key: string } & ({ kind: "loading" } | { kind: "done"; bullets: string[] } | { kind: "error"; message: string })
  >({ key: "", kind: "error", message: "" });
  const state = result.key === key ? result : { kind: "idle" as const };
  const stale = result.key !== "" && result.key !== key && result.kind === "done";

  async function summarize() {
    const forKey = key;
    setResult({ key: forKey, kind: "loading" });
    const res = await postAi<{ bullets: string[] }>("summary", filters);
    // Ignore a reply for filters the user has already changed.
    setResult((r) => (r.key !== forKey ? r : res.ok ? { key: forKey, kind: "done", bullets: res.data.bullets } : { key: forKey, kind: "error", message: res.message }));
  }

  return (
    <section className="relative overflow-hidden rounded-2xl border border-violet-200/70 bg-gradient-to-br from-violet-50/80 via-white to-indigo-50/60 p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-5 dark:border-violet-900/50 dark:from-violet-950/40 dark:via-zinc-900/50 dark:to-indigo-950/30">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-sm shadow-violet-900/20" aria-hidden>
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="currentColor">
              <path d="M12 2.5c.4 0 .7.3.8.6l1.2 4.1a4 4 0 0 0 2.8 2.8l4.1 1.2a.8.8 0 0 1 0 1.6l-4.1 1.2a4 4 0 0 0-2.8 2.8l-1.2 4.1a.8.8 0 0 1-1.6 0l-1.2-4.1a4 4 0 0 0-2.8-2.8l-4.1-1.2a.8.8 0 0 1 0-1.6l4.1-1.2a4 4 0 0 0 2.8-2.8l1.2-4.1c.1-.3.4-.6.8-.6Z" />
            </svg>
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">AI summary</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {state.kind === "idle" && stale ? "The filters changed. Summarize again for the new numbers." : "3–5 insights written only from the numbers on this dashboard."}
            </p>
          </div>
        </div>
        <button
          onClick={summarize}
          disabled={state.kind === "loading"}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 text-sm font-medium text-white shadow-sm shadow-violet-900/10 transition hover:bg-violet-700 active:bg-violet-800 disabled:opacity-60"
        >
          {state.kind === "loading" && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
          {state.kind === "loading" ? "Summarizing…" : state.kind === "done" ? "Refresh" : "Summarize"}
        </button>
      </div>

      {state.kind === "loading" && (
        <ul className="mt-4 space-y-2.5" aria-busy>
          {["w-11/12", "w-9/12", "w-10/12"].map((w) => (
            <li key={w} className={`h-3.5 animate-pulse rounded-full bg-violet-100 dark:bg-violet-950/60 ${w}`} />
          ))}
        </ul>
      )}
      {state.kind === "error" && (
        <p role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/60 dark:text-amber-200">
          {state.message}
        </p>
      )}
      {state.kind === "done" && (
        <div className="mt-4 space-y-3">
          <ul className="grid gap-2 sm:grid-cols-2">
            {state.bullets.map((b, i) => (
              <li key={i} className="flex gap-2.5 rounded-xl border border-white/80 bg-white/80 px-3 py-2.5 text-sm leading-relaxed text-zinc-700 shadow-sm shadow-zinc-900/5 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-200">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[11px] font-semibold text-violet-700 dark:bg-violet-950 dark:text-violet-300">{i + 1}</span>
                <span className="min-w-0">{b}</span>
              </li>
            ))}
          </ul>
          <AiBadge />
        </div>
      )}
    </section>
  );
}
