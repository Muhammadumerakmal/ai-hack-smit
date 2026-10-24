"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// People-area building blocks (directory, Employee 360, users, settings).
// They sit on top of src/components/ui.tsx tokens: teal = product, zinc = UI, rounded-2xl surfaces.

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ---------- Icons (24×24 line icons, 1.75 stroke, same style as the shell) ----------

const PATHS: Record<string, string> = {
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M20 20l-4-4",
  plus: "M12 5v14M5 12h14",
  upload: "M12 15V4M7.5 8.5 12 4l4.5 4.5M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15",
  download: "M12 4v11M7.5 10.5 12 15l4.5-4.5M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15",
  mail: "M4 6.5h16v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM4 7l8 6 8-6",
  phone: "M6.5 4h3l1.5 4-2 1.5a10 10 0 0 0 5.5 5.5l1.5-2 4 1.5v3a2 2 0 0 1-2 2A15 15 0 0 1 4.5 6a2 2 0 0 1 2-2",
  pin: "M12 21s-6.5-5.4-6.5-11a6.5 6.5 0 0 1 13 0c0 5.6-6.5 11-6.5 11M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5",
  calendar: "M7 4v3M17 4v3M4.5 10h15M6 6h12a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 18 20H6a1.5 1.5 0 0 1-1.5-1.5v-11A1.5 1.5 0 0 1 6 6",
  building: "M5 20V5.5A1.5 1.5 0 0 1 6.5 4h7A1.5 1.5 0 0 1 15 5.5V20M15 10h3.5a1.5 1.5 0 0 1 1.5 1.5V20M3.5 20h17M8.5 8h3M8.5 11.5h3M8.5 15h3",
  briefcase: "M3.5 8h17v10.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5zM8.5 8V6a1.5 1.5 0 0 1 1.5-1.5h4A1.5 1.5 0 0 1 15.5 6v2M3.5 13h17",
  user: "M18 20v-1.5a4 4 0 0 0-4-4h-4a4 4 0 0 0-4 4V20M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7",
  users: "M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M20 19v-1.2a3 3 0 0 0-2.2-2.9M15.5 5.2a3 3 0 0 1 0 5.6",
  key: "M8 15a4 4 0 1 1 3.5-6M11.5 9 20 9M17 9v3M20 9v2.5M8 13a1 1 0 1 0 0-2",
  shield: "M12 3.5 19 6v5.5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6zM9 12l2 2 4-4",
  dots: "M5 12h.01M12 12h.01M19 12h.01",
  copy: "M9 9h10v10H9zM5 15V5h10",
  check: "M5 12.5l4.5 4.5L19 7",
  x: "M6 6l12 12M18 6 6 18",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  trash: "M5 7h14M10 11v6M14 11v6M6.5 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5L17.5 7M9.5 7V5h5v2",
  chevronLeft: "M14.5 6 8.5 12l6 6",
  chevronRight: "M9.5 6l6 6-6 6",
  arrowLeft: "M19 12H5M11 6l-6 6 6 6",
  clock: "M12 21a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17M12 8v4.5l3 2",
  wallet: "M4 7.5A1.5 1.5 0 0 1 5.5 6H18v3M4 7.5v10A1.5 1.5 0 0 0 5.5 19h13a1.5 1.5 0 0 0 1.5-1.5V10.5A1.5 1.5 0 0 0 18.5 9H5.5A1.5 1.5 0 0 1 4 7.5M16 14h.01",
  file: "M7 3.5h7.5L18 7v13.5H7a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1M14 3.5V7h4M9.5 12h5M9.5 15.5h5",
  lock: "M6.5 11h11a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V12a1 1 0 0 1 1-1M8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  sliders: "M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4",
  leaf: "M5 19c8 0 14-5 14-14-9 0-14 6-14 14M5 19l7-7",
  flag: "M5 21V4.5M5 5h11l-2 3.5 2 3.5H5",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 11v5M12 8h.01",
  filter: "M4 6h16M7 12h10M10 18h4",
  external: "M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10",
};

export function PIcon({ name, className = "h-4 w-4" }: { name: keyof typeof PATHS | string; className?: string }) {
  const d = PATHS[name];
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {d && <path d={d} />}
    </svg>
  );
}

// ---------- Avatar (initials, deterministic tint) ----------

const TINTS = [
  "bg-teal-100 text-teal-800 dark:bg-teal-900/60 dark:text-teal-200",
  "bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200",
  "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200",
  "bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200",
  "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200",
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200",
  "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
];

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" | "xl" }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const dims = { sm: "h-8 w-8 text-[11px]", md: "h-9 w-9 text-xs", lg: "h-12 w-12 text-sm", xl: "h-16 w-16 text-lg sm:h-20 sm:w-20 sm:text-xl" }[size];
  return (
    <span className={cx("inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold tracking-wide", dims, TINTS[h % TINTS.length])} aria-hidden>
      {initials(name)}
    </span>
  );
}

// ---------- Inputs ----------

export function SearchInput({ value, onChange, placeholder, label = "Search" }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string }) {
  return (
    <div className="relative min-w-0 flex-1">
      <PIcon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="h-10 w-full rounded-lg border border-zinc-300 bg-white pl-9 pr-3 text-sm shadow-sm shadow-zinc-900/5 outline-none transition-colors placeholder:text-zinc-400 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15 dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-500"
      />
    </div>
  );
}

export const selectCls =
  "h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm shadow-sm shadow-zinc-900/5 outline-none transition-colors focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900";

/** Toolbar button (secondary look) with an icon; label hides on very small screens when `compact`. */
export function ToolButton({
  icon,
  children,
  onClick,
  variant = "secondary",
  type = "button",
  disabled,
  title,
}: {
  icon?: string;
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
  title?: string;
}) {
  const styles = {
    primary: "bg-teal-600 text-white shadow-sm shadow-teal-900/10 hover:bg-teal-700 active:bg-teal-800",
    secondary: "border border-zinc-300 bg-white text-zinc-800 shadow-sm shadow-zinc-900/5 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800",
    ghost: "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
    danger: "border border-red-200 bg-white text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:bg-zinc-900 dark:text-red-300 dark:hover:bg-red-950/40",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cx(
        "inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/60 disabled:cursor-not-allowed disabled:opacity-50",
        styles,
      )}
    >
      {icon && <PIcon name={icon} className="h-4 w-4 shrink-0" />}
      {children}
    </button>
  );
}

// ---------- Surfaces ----------

export function Surface({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-2xl border border-zinc-200/80 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)] dark:border-zinc-800/80 dark:bg-zinc-900/50 dark:shadow-none", className)}>
      {children}
    </section>
  );
}

export function SectionHeading({ title, hint, icon, actions }: { title: string; hint?: string; icon?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300">
            <PIcon name={icon} />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {hint && <p className="mt-0.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{hint}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Group label inside long forms. */
export function FormSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3 border-t border-zinc-200/80 pt-5 first:border-t-0 first:pt-0 dark:border-zinc-800/80">
      <legend className="sr-only">{title}</legend>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">{title}</p>
        {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span className={cx("block animate-pulse rounded-md bg-zinc-200/70 dark:bg-zinc-800/70", className)} aria-hidden />;
}

export function RowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y divide-zinc-100 dark:divide-zinc-800/70" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-40 max-w-[60%]" />
            <Skeleton className="h-2.5 w-56 max-w-[80%]" />
          </div>
          <Skeleton className="hidden h-5 w-16 rounded-full sm:block" />
        </div>
      ))}
    </div>
  );
}

// ---------- Panel (dialog / right drawer); near full-screen on phones ----------

export function Panel({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  variant = "dialog",
  size = "md",
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  variant?: "dialog" | "drawer";
  size?: "sm" | "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const width = { sm: "sm:max-w-md", md: "sm:max-w-xl", lg: "sm:max-w-3xl" }[size];
  const shape =
    variant === "drawer"
      ? cx("m-0 ml-auto h-dvh max-h-dvh w-full rounded-none sm:rounded-l-2xl", width)
      : cx("m-0 mt-auto max-h-[94dvh] w-full rounded-t-2xl sm:m-auto sm:max-h-[88dvh] sm:rounded-2xl", width);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className={cx(
        "max-w-none overflow-hidden border border-zinc-200 bg-white p-0 text-zinc-900 shadow-2xl backdrop:bg-zinc-950/50 backdrop:backdrop-blur-[2px] dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100",
        shape,
      )}
    >
      <div className={cx("flex flex-col", variant === "drawer" ? "h-dvh" : "max-h-[94dvh] sm:max-h-[88dvh]")}>
        <header className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight">{title}</h2>
            {description && <p className="mt-0.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{description}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <PIcon name="x" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && (
          <footer className="flex flex-col-reverse gap-2 border-t border-zinc-200 bg-zinc-50/70 px-5 py-3.5 sm:flex-row sm:justify-end dark:border-zinc-800 dark:bg-zinc-900/40">
            {footer}
          </footer>
        )}
      </div>
    </dialog>
  );
}

// ---------- One-time secret (temporary password) ----------

export function SecretReveal({ email, secret, note }: { email: string; secret: string; note?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
        <PIcon name="key" className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          {note ?? "Shown only once."} Share it with <b className="break-all">{email}</b> privately. They must change it at first sign-in.
        </p>
      </div>
      <div className="flex items-stretch overflow-hidden rounded-xl border border-zinc-300 dark:border-zinc-700">
        <code className="flex flex-1 items-center justify-center bg-zinc-50 px-3 py-3 font-mono text-lg tracking-[0.12em] text-zinc-900 select-all dark:bg-zinc-900 dark:text-zinc-50">
          {secret}
        </code>
        <button
          type="button"
          onClick={copy}
          className="flex min-w-[96px] items-center justify-center gap-1.5 border-l border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
        >
          <PIcon name={copied ? "check" : "copy"} />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

// ---------- Row action menu ----------

export interface MenuItem {
  label: string;
  icon?: string;
  onSelect: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
}

export function ActionMenu({ items, label = "Actions" }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative inline-block text-left" ref={ref}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
      >
        <PIcon name="dots" className="h-5 w-5" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              type="button"
              disabled={it.disabled}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
              className={cx(
                "flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm disabled:cursor-not-allowed disabled:opacity-40",
                it.tone === "danger" ? "text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40" : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-900",
              )}
            >
              {it.icon && <PIcon name={it.icon} className="h-4 w-4 shrink-0 opacity-70" />}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Paging ----------

export function PagerBar({ page, pageSize, total, onPage, noun = "results" }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; noun?: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-col gap-3 border-t border-zinc-200/80 px-4 py-3 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:px-5 dark:border-zinc-800/80">
      <span>
        Showing <b className="font-medium text-zinc-800 dark:text-zinc-200">{from}–{to}</b> of <b className="font-medium text-zinc-800 dark:text-zinc-200">{total}</b> {noun}
      </span>
      {pages > 1 && (
        <div className="flex items-center gap-2">
          <ToolButton icon="chevronLeft" onClick={() => onPage(page - 1)} disabled={page <= 1}>
            Previous
          </ToolButton>
          <span className="px-1 tabular-nums">
            {page} / {pages}
          </span>
          <ToolButton onClick={() => onPage(page + 1)} disabled={page >= pages}>
            Next
            <PIcon name="chevronRight" />
          </ToolButton>
        </div>
      )}
    </div>
  );
}

// ---------- Misc ----------

export function Meter({ value, max, tone = "teal" }: { value: number; max: number; tone?: "teal" | "amber" | "red" }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const bar = { teal: "bg-teal-500", amber: "bg-amber-500", red: "bg-red-500" }[tone];
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className={cx("h-full rounded-full transition-[width] duration-500", bar)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function ReadOnlyBanner({ children }: { children: ReactNode }) {
  return (
    <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300">
      <PIcon name="lock" className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
