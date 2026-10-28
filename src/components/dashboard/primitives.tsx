"use client";

import type { ReactNode } from "react";

// Building blocks for the dashboard, announcements and audit screens.
// They sit on top of the shared UI kit's look (rounded-2xl surfaces, zinc neutrals, teal brand).

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

const ICONS: Record<string, string> = {
  people: "M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M20 19v-1.2a3 3 0 0 0-2.2-2.9M15.5 5.2a3 3 0 0 1 0 5.6",
  check: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M8.5 12.2l2.4 2.4 4.6-4.8",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7.5V12l3 2",
  leave: "M7 4v3M17 4v3M4.5 10h15M6 6h12a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 18 20H6a1.5 1.5 0 0 1-1.5-1.5v-11A1.5 1.5 0 0 1 6 6",
  inbox: "M4 13.5 6.2 5.6A1.5 1.5 0 0 1 7.6 4.5h8.8a1.5 1.5 0 0 1 1.4 1.1L20 13.5M4 13.5V18a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 18v-4.5M4 13.5h4.5l1 2h5l1-2H20",
  money: "M3.5 7h17v10h-17zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5M6.5 10v4M17.5 10v4",
  trend: "M4 17 9.5 11.5l3.5 3.5L20 8M15 8h5v5",
  exit: "M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10",
  filter: "M4 6h16M7 12h10M10 18h4",
  refresh: "M20 11a8 8 0 0 0-14.6-4.5M4 4v3.5h3.5M4 13a8 8 0 0 0 14.6 4.5M20 20v-3.5h-3.5",
  chevron: "m9 6 6 6-6 6",
  down: "m6 9 6 6 6-6",
  megaphone: "M4 10v4a1 1 0 0 0 1 1h2l5 4V5L7 9H5a1 1 0 0 0-1 1M16 9a4 4 0 0 1 0 6",
  sparkle: "M12 3.5 13.8 9 19.5 10.8 13.8 12.6 12 18.5 10.2 12.6 4.5 10.8 10.2 9z",
  shield: "M12 3.5 19 6v5.5c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z",
  doc: "M7 3.5h7.5L18 7v13.5H7a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1M14 3.5V7h4M9.5 12h5M9.5 15.5h5",
  arrow: "M5 12h14M13 6l6 6-6 6",
};

export function DIcon({ name, className = "h-4 w-4" }: { name: keyof typeof ICONS | string; className?: string }) {
  const d = ICONS[name];
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {d && <path d={d} />}
    </svg>
  );
}

const SURFACE =
  "rounded-2xl glass";

/** A titled surface. `subtitle` says what is plotted (a single series needs no legend). */
export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx(SURFACE, "flex min-w-0 flex-col", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 pt-4 sm:px-5 sm:pt-5">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={cx("min-w-0 flex-1 px-4 pb-4 pt-3 sm:px-5 sm:pb-5", bodyClassName)}>{children}</div>
    </section>
  );
}

type Tone = "default" | "good" | "warn" | "bad" | "info";

const TONE_ICON: Record<Tone, string> = {
  default: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  good: "bg-teal-50 text-teal-700 dark:bg-teal-950/70 dark:text-teal-300",
  warn: "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  bad: "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300",
  info: "bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
};

/** KPI tile: label · value · context. The icon chip carries the tone; the number stays in ink. */
export function Kpi({
  label,
  value,
  hint,
  icon,
  tone = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: string;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div className={cx(SURFACE, "flex min-w-0 flex-col gap-3 p-4", className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] font-medium leading-tight text-zinc-500 dark:text-zinc-400">{label}</p>
        {icon && (
          <span className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", TONE_ICON[tone])}>
            <DIcon name={icon} />
          </span>
        )}
      </div>
      <p className="text-2xl font-semibold leading-none tracking-tight text-zinc-900 sm:text-[1.75rem] dark:text-zinc-50">{value}</p>
      {hint && <p className="text-xs leading-snug text-zinc-500 dark:text-zinc-400">{hint}</p>}
    </div>
  );
}

/** Progress against a target; the unfilled track is a light step of the same hue. */
export function Meter({ value, max, tone = "teal", label }: { value: number; max: number; tone?: "teal" | "amber"; label: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cx("h-2 w-full overflow-hidden rounded-full", tone === "teal" ? "bg-teal-100 dark:bg-teal-950" : "bg-amber-100 dark:bg-amber-950")}
    >
      <div className={cx("h-full rounded-full transition-[width] duration-500", tone === "teal" ? "bg-teal-600" : "bg-amber-500")} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-md bg-zinc-200/70 dark:bg-zinc-800/70", className)} aria-hidden />;
}

/** Page-shaped placeholder while the first load is in flight. */
export function DashboardSkeleton({ tiles = 5 }: { tiles?: number }) {
  return (
    <div className="space-y-4" role="status" aria-label="Loading dashboard">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: tiles }, (_, i) => (
          <div key={i} className={cx(SURFACE, "space-y-3 p-4")}>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className={cx(SURFACE, "space-y-3 p-5 xl:col-span-2")}>
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-48 w-full" />
        </div>
        <div className={cx(SURFACE, "space-y-3 p-5")}>
          <Skeleton className="h-4 w-32" />
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden
      className={cx(
        "flex shrink-0 items-center justify-center rounded-full bg-teal-50 font-semibold text-teal-800 ring-1 ring-inset ring-teal-600/15 dark:bg-teal-950 dark:text-teal-200",
        size === "sm" ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-xs",
      )}
    >
      {initials(name || "?")}
    </span>
  );
}

/** "3 min ago" / "yesterday" / a date, from an ISO timestamp. */
export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  if (s < 172_800) return "yesterday";
  if (s < 7 * 86_400) return `${Math.round(s / 86_400)} days ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Karachi" });
}

/** Small "Chart / Table" switch so every chart has a table view (values reachable without hover). */
export function ViewToggle({ value, onChange }: { value: "chart" | "table"; onChange: (v: "chart" | "table") => void }) {
  return (
    <div role="group" aria-label="View" className="inline-flex rounded-lg glass-control p-0.5 text-[11px] font-medium">
      {(["chart", "table"] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cx(
            "min-h-7 rounded-md px-2 capitalize transition-colors",
            value === v ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200",
          )}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

export function LinkArrow({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex min-h-8 items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-300">
      {children}
      <DIcon name="arrow" className="h-3.5 w-3.5" />
    </span>
  );
}
