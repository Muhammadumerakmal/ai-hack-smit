"use client";

import type { ReactNode } from "react";
import { addMonths, initials, labelCase, monthLabel } from "./format";
import { OpsIcon, type OpsIconName } from "./icons";

// Building blocks for the operations screens. They sit on top of the shared UI kit's look
// (rounded-2xl surfaces, zinc neutrals, teal primary) and add what those screens need:
// responsive data lists (table on tablet+, cards on phones), skeletons, KPI tiles, month switcher.

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

const SURFACE =
  "rounded-2xl glass";

// ---------- Status palette (one mapping for every status on these screens) ----------

export type Tone = "teal" | "amber" | "orange" | "yellow" | "red" | "sky" | "indigo" | "zinc";

export const STATUS_TONE: Record<string, Tone> = {
  present: "teal",
  approved: "teal",
  finalized: "teal",
  late: "amber",
  pending: "amber",
  draft: "amber",
  half_day: "orange",
  missing_checkout: "yellow",
  absent: "red",
  rejected: "red",
  on_leave: "sky",
  holiday: "indigo",
  cancelled: "zinc",
  weekend: "zinc",
  not_checked_in: "zinc",
  not_employed: "zinc",
  future: "zinc",
};

export const toneOf = (status: string): Tone => STATUS_TONE[status.toLowerCase()] ?? "zinc";

export const DOT: Record<Tone, string> = {
  teal: "bg-teal-500",
  amber: "bg-amber-500",
  orange: "bg-orange-500",
  yellow: "bg-yellow-400",
  red: "bg-red-500",
  sky: "bg-sky-500",
  indigo: "bg-indigo-500",
  zinc: "bg-zinc-400 dark:bg-zinc-500",
};

const PILL: Record<Tone, string> = {
  teal: "bg-teal-50 text-teal-800 ring-teal-600/20 dark:bg-teal-500/10 dark:text-teal-300 dark:ring-teal-400/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20",
  orange: "bg-orange-50 text-orange-800 ring-orange-600/20 dark:bg-orange-500/10 dark:text-orange-300 dark:ring-orange-400/20",
  yellow: "bg-yellow-50 text-yellow-800 ring-yellow-600/25 dark:bg-yellow-500/10 dark:text-yellow-200 dark:ring-yellow-400/20",
  red: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/20",
  sky: "bg-sky-50 text-sky-800 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/20",
  indigo: "bg-indigo-50 text-indigo-800 ring-indigo-600/20 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-400/20",
  zinc: "bg-zinc-100 text-zinc-700 ring-zinc-500/20 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-600/30",
};

/** Status pill with a coloured dot. */
export function StatusPill({ status, label }: { status: string; label?: string }) {
  const tone = toneOf(status);
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", PILL[tone])}>
      <span className={cx("h-1.5 w-1.5 rounded-full", DOT[tone])} aria-hidden />
      {labelCase(label ?? status.toLowerCase())}
    </span>
  );
}

// ---------- Surfaces ----------

export function Panel({
  title,
  subtitle,
  icon,
  actions,
  children,
  className,
  flush,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: OpsIconName;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** no body padding (lists/tables that run edge to edge) */
  flush?: boolean;
}) {
  return (
    <section className={cx(SURFACE, "min-w-0", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-100 px-4 py-4 sm:px-5 dark:border-zinc-800/70">
          <div className="flex min-w-0 items-start gap-3">
            {icon && (
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300">
                <OpsIcon name={icon} className="h-[18px] w-[18px]" />
              </span>
            )}
            <div className="min-w-0">
              {title && <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>}
              {subtitle && <p className="mt-0.5 text-[13px] text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{actions}</div>}
        </header>
      )}
      <div className={flush ? "" : "p-4 sm:p-5"}>{children}</div>
    </section>
  );
}

export function KpiTile({
  label,
  value,
  hint,
  icon,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: OpsIconName;
  tone?: "default" | "good" | "warn" | "bad" | "info";
}) {
  const color = {
    default: "text-zinc-900 dark:text-zinc-50",
    good: "text-teal-700 dark:text-teal-300",
    warn: "text-amber-700 dark:text-amber-300",
    bad: "text-red-600 dark:text-red-400",
    info: "text-sky-700 dark:text-sky-300",
  }[tone];
  return (
    <div className={cx(SURFACE, "min-w-0 p-4")}>
      {/* Label, value and hint wrap rather than truncate: a cut-off number ("94.…") is worse than a second line. */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium uppercase leading-snug tracking-[0.08em] text-zinc-500 dark:text-zinc-400">{label}</p>
        {icon && <OpsIcon name={icon} className="h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500" />}
      </div>
      <p className={cx("mt-2 text-2xl font-semibold leading-tight tracking-tight tabular-nums", color)}>{value}</p>
      {hint && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
    </div>
  );
}

export function Banner({
  tone,
  icon,
  title,
  children,
  actions,
}: {
  tone: "info" | "warn" | "good" | "neutral";
  icon: OpsIconName;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const c = {
    info: "border-sky-200 bg-sky-50/70 text-sky-950 dark:border-sky-500/20 dark:bg-sky-500/5 dark:text-sky-100",
    warn: "border-amber-200 bg-amber-50/70 text-amber-950 dark:border-amber-500/20 dark:bg-amber-500/5 dark:text-amber-100",
    good: "border-teal-200 bg-teal-50/70 text-teal-950 dark:border-teal-500/20 dark:bg-teal-500/5 dark:text-teal-100",
    neutral: "border-zinc-200 bg-zinc-50 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-100",
  }[tone];
  const iconC = { info: "text-sky-600", warn: "text-amber-600", good: "text-teal-600", neutral: "text-zinc-500 dark:text-zinc-400" }[tone];
  return (
    <div className={cx("flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between", c)}>
      <div className="flex min-w-0 items-start gap-3">
        <OpsIcon name={icon} className={cx("mt-0.5 h-5 w-5 shrink-0", iconC)} />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          {children && <div className="mt-0.5 text-[13px] opacity-80">{children}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2 sm:shrink-0">{actions}</div>}
    </div>
  );
}

// ---------- Loading skeletons ----------

export function Skeleton({ className }: { className?: string }) {
  return <span className={cx("block animate-pulse rounded-md bg-zinc-200/70 dark:bg-zinc-800", className)} aria-hidden />;
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-4 sm:p-5" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="hidden h-5 w-16 rounded-full sm:block" />
        </div>
      ))}
    </div>
  );
}

export function TilesSkeleton({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={cx(SURFACE, "space-y-3 p-4")} aria-hidden>
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-3 w-28" />
        </div>
      ))}
    </>
  );
}

export function EmptyBlock({ icon = "inbox", title, hint, action }: { icon?: OpsIconName; title: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
        <OpsIcon name={icon} className="h-5 w-5" />
      </span>
      <p className="mt-1 text-sm font-medium">{title}</p>
      {hint && <p className="max-w-sm text-[13px] text-zinc-500 dark:text-zinc-400">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

// ---------- People ----------

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  return (
    <span
      className={cx(
        "flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-100 to-teal-200 font-semibold text-teal-800 dark:from-teal-500/20 dark:to-teal-500/10 dark:text-teal-200",
        size === "sm" ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-xs",
      )}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

export function PersonCell({ name, meta }: { name: string; meta?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={name} />
      <div className="min-w-0">
        <p className="truncate font-medium text-zinc-900 dark:text-zinc-100">{name}</p>
        {meta && <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{meta}</p>}
      </div>
    </div>
  );
}

// ---------- Controls ----------

const CONTROL =
  "inline-flex h-10 items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-700 shadow-sm shadow-zinc-900/5 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800";

/** ‹ October 2026 › with a native month picker behind the label. */
export function MonthSwitcher({ value, onChange, max }: { value: string; onChange: (m: string) => void; max?: string }) {
  const atMax = !!max && value >= max;
  return (
    <div className="flex w-full items-center gap-1.5 sm:w-auto">
      <button type="button" className={cx(CONTROL, "w-10 shrink-0")} onClick={() => onChange(addMonths(value, -1))} aria-label="Previous month">
        <OpsIcon name="chevronLeft" />
      </button>
      <label className={cx(CONTROL, "relative min-w-0 flex-1 cursor-pointer gap-2 px-3 text-sm font-medium sm:w-44 sm:flex-none")}>
        <OpsIcon name="calendar" className="h-4 w-4 shrink-0 text-zinc-400" />
        <span className="truncate">{monthLabel(value)}</span>
        <input
          type="month"
          value={value}
          max={max}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label="Choose month"
        />
      </label>
      <button type="button" className={cx(CONTROL, "w-10 shrink-0")} onClick={() => onChange(addMonths(value, 1))} disabled={atMax} aria-label="Next month">
        <OpsIcon name="chevronRight" />
      </button>
    </div>
  );
}

/** Pill tabs with counts; wraps onto a second row on narrow screens so no tab is hidden. */
export function SegmentedTabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div role="tablist">
      <div className="inline-flex max-w-full flex-wrap gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900">
        {tabs.map((t) => {
          const active = t.id === value;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => onChange(t.id)}
              className={cx(
                "inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors",
                active
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                  : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200",
              )}
            >
              {t.label}
              {t.count != null && (
                <span
                  className={cx(
                    "min-w-5 rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
                    active ? "bg-teal-700 text-white dark:bg-teal-500 dark:text-zinc-950" : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
                  )}
                >
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A link that looks like the kit's secondary/primary button (for downloads). */
export function ButtonLink({ href, children, variant = "secondary", className }: { href: string; children: ReactNode; variant?: "primary" | "secondary"; className?: string }) {
  return (
    <a
      href={href}
      className={cx(
        "inline-flex h-10 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/60 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950",
        variant === "primary"
          ? "bg-teal-700 text-white shadow-sm hover:bg-teal-800"
          : "border border-zinc-300 bg-white text-zinc-800 shadow-sm shadow-zinc-900/5 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800",
        className,
      )}
    >
      {children}
    </a>
  );
}

export function ProgressBar({ segments, label }: { segments: { value: number; className: string }[]; label: string }) {
  const total = Math.max(1, segments.reduce((n, s) => n + s.value, 0));
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" role="img" aria-label={label}>
      {segments.map((s, i) => (
        <span key={i} className={s.className} style={{ width: `${(Math.max(0, s.value) / total) * 100}%` }} />
      ))}
    </div>
  );
}

// ---------- Responsive data list: table on md+, cards on phones ----------

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  className?: string;
  /** hide on the phone card (e.g. it's already in the card title) */
  hideOnMobile?: boolean;
}

export function DataList<T>({
  rows,
  rowKey,
  columns,
  title,
  aside,
  actions,
  footer,
  mobileFooter,
  rowClassName,
}: {
  rows: T[];
  rowKey: (row: T) => string;
  columns: Column<T>[];
  /** phone card heading */
  title: (row: T) => ReactNode;
  /** phone card top-right (usually the status) */
  aside?: (row: T) => ReactNode;
  /** row actions (last table column; full-width row on phone cards) */
  actions?: (row: T) => ReactNode;
  /** table footer cells, one per column (+1 if actions) */
  footer?: ReactNode[];
  mobileFooter?: ReactNode;
  rowClassName?: (row: T) => string | undefined;
}) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50/70 text-[11px] uppercase tracking-[0.06em] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cx("whitespace-nowrap px-4 py-3 font-medium first:pl-5 last:pr-5", c.align === "right" && "text-right")}>
                  {c.header}
                </th>
              ))}
              {actions && (
                <th scope="col" className="px-4 py-3 pr-5 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
            {rows.map((r) => (
              <tr key={rowKey(r)} className={cx("transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-900/40", rowClassName?.(r))}>
                {columns.map((c) => (
                  <td key={c.key} className={cx("px-4 py-3 align-middle first:pl-5 last:pr-5", c.align === "right" && "text-right tabular-nums", c.className)}>
                    {c.cell(r)}
                  </td>
                ))}
                {actions && <td className="whitespace-nowrap px-4 py-3 pr-5 text-right align-middle">{actions(r)}</td>}
              </tr>
            ))}
          </tbody>
          {footer && (
            <tfoot>
              <tr className="border-t-2 border-zinc-200 bg-zinc-50/70 font-semibold dark:border-zinc-700 dark:bg-zinc-900/40">
                {footer.map((f, i) => (
                  <td key={i} className={cx("px-4 py-3 first:pl-5 last:pr-5", i >= 1 && columns[i]?.align === "right" && "text-right tabular-nums")}>
                    {f}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <ul className="divide-y divide-zinc-100 md:hidden dark:divide-zinc-800/70">
        {rows.map((r) => (
          <li key={rowKey(r)} className={cx("space-y-3 px-4 py-4", rowClassName?.(r))}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">{title(r)}</div>
              {aside && <div className="shrink-0">{aside(r)}</div>}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {columns
                .filter((c) => !c.hideOnMobile)
                .map((c) => (
                  <div key={c.key} className="min-w-0">
                    <dt className="text-[11px] uppercase tracking-[0.06em] text-zinc-500 dark:text-zinc-400">{c.header}</dt>
                    <dd className={cx("mt-0.5 min-w-0 break-words", c.align === "right" && "tabular-nums")}>{c.cell(r)}</dd>
                  </div>
                ))}
            </dl>
            {actions && <div className="flex flex-wrap gap-2 [&>*]:flex-1">{actions(r)}</div>}
          </li>
        ))}
        {mobileFooter && <li className="bg-zinc-50/70 px-4 py-4 dark:bg-zinc-900/40">{mobileFooter}</li>}
      </ul>
    </>
  );
}
