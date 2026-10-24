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
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">AI summary</h2>
        <button
          onClick={summarize}
          disabled={state.kind === "loading"}
          className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {state.kind === "loading" ? "Summarizing…" : state.kind === "done" ? "Refresh" : "Summarize"}
        </button>
      </div>

      {state.kind === "idle" && (
        <p className="text-sm text-zinc-500">
          {stale ? "The filters changed. Summarize again for the new numbers." : "Get 3–5 insights from the numbers on this dashboard."}
        </p>
      )}
      {state.kind === "loading" && (
        <ul className="space-y-2" aria-busy>
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-4 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
          ))}
        </ul>
      )}
      {state.kind === "error" && <p className="text-sm text-amber-700 dark:text-amber-300">{state.message}</p>}
      {state.kind === "done" && (
        <div className="space-y-2">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {state.bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
          <AiBadge />
        </div>
      )}
    </section>
  );
}
