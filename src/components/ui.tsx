"use client";

import { cloneElement, createContext, isValidElement, useContext, useEffect, useId, useRef, type ReactNode } from "react";
import { humanize } from "@/components/ops/format";

// Shared UI kit. Every screen uses these so spacing, colours and states stay consistent.
// Theme: teal primary (brief colours), violet only for AI, zinc neutrals, dark mode via `dark:`.

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-2xl glass p-5", className)}>
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold tracking-tight">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone = "default" }: { label: string; value: ReactNode; hint?: string; tone?: "default" | "good" | "warn" | "bad" }) {
  const color = { default: "text-zinc-900 dark:text-zinc-50", good: "text-teal-600 dark:text-teal-400", warn: "text-amber-600 dark:text-amber-400", bad: "text-red-600 dark:text-red-400" }[tone];
  return (
    <div className="rounded-2xl glass p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className={cx("mt-2 text-[1.75rem] font-semibold leading-none tracking-tight tabular-nums", color)}>{value}</p>
      {hint && <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
    </div>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" | "ai"; size?: "sm" | "md"; loading?: boolean };

export function Button({ variant = "primary", size = "md", loading, className, children, disabled, ...rest }: ButtonProps) {
  const styles = {
    primary: "bg-teal-700 text-white shadow-sm shadow-teal-900/10 hover:bg-teal-800 active:bg-teal-900",
    secondary: "border border-zinc-300 bg-white text-zinc-800 shadow-sm shadow-zinc-900/5 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800",
    danger: "bg-red-600 text-white hover:bg-red-700",
    ghost: "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
    // AI actions only (violet is reserved for AI across the app)
    ai: "bg-violet-600 text-white shadow-sm shadow-violet-900/10 hover:bg-violet-700 active:bg-violet-800",
  }[variant];
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-zinc-950",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-10 px-4 text-sm",
        styles,
        className,
      )}
    >
      {loading && <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  );
}

const fieldCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm shadow-zinc-900/5 outline-none transition-colors placeholder:text-zinc-400 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15 aria-invalid:border-red-500 aria-invalid:focus:ring-red-500/15 disabled:opacity-60 dark:border-zinc-700 dark:aria-invalid:border-red-500 dark:bg-zinc-900 dark:placeholder:text-zinc-500";

/** Server validation errors by field name; each <Field name="…"> inside shows its own one under the input. */
const FieldErrorsContext = createContext<Record<string, string>>({});
export function FieldErrors({ errors, children }: { errors: Record<string, string>; children: ReactNode }) {
  return <FieldErrorsContext.Provider value={errors}>{children}</FieldErrorsContext.Provider>;
}

type FieldControlProps = { required?: boolean; "aria-describedby"?: string; "aria-invalid"?: boolean };

/**
 * Label + control + hint/error. A required control gets a visible "*" (screen readers already hear "required"),
 * and the hint or error is linked to the control with aria-describedby, so it is read with the field.
 */
export function Field({
  label,
  hint,
  error,
  name,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  /** Field name in the API body: picks up its error from <FieldErrors>. */
  name?: string;
  children: ReactNode;
  className?: string;
}) {
  const fromServer = useContext(FieldErrorsContext);
  const message = error ?? (name ? fromServer[name] : undefined);
  const msgId = useId();
  const control = isValidElement<FieldControlProps>(children) ? children : null;
  const required = !!control?.props.required;
  const described = message || hint ? msgId : undefined;
  return (
    <label className={cx("block space-y-1.5", className)}>
      <span className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">
        {label}
        {required && (
          <span className="ml-0.5 text-red-600 dark:text-red-400" aria-hidden>
            *
          </span>
        )}
      </span>
      {control ? cloneElement(control, { "aria-describedby": described, "aria-invalid": message ? true : undefined }) : children}
      {message ? (
        <span id={msgId} className="flex items-start gap-1 text-xs font-medium text-red-600 dark:text-red-400">
          <svg viewBox="0 0 16 16" className="mt-px h-3.5 w-3.5 shrink-0" fill="currentColor" aria-hidden>
            <path d="M8 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13Zm0 3a.75.75 0 0 0-.75.75v3.5a.75.75 0 0 0 1.5 0v-3.5A.75.75 0 0 0 8 4.5Zm0 6.25a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8Z" />
          </svg>
          {message}
        </span>
      ) : hint ? (
        <span id={msgId} className="block text-xs text-zinc-500 dark:text-zinc-400">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export const Input = ({ className, ...p }: React.InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(fieldCls, className)} />;
export const Textarea = ({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(fieldCls, className)} />;
export const Select = ({ className, children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...p} className={cx(fieldCls, className)}>
    {children}
  </select>
);

const BADGE: Record<string, string> = {
  green: "bg-teal-50 text-teal-700 ring-teal-600/20 dark:bg-teal-950 dark:text-teal-300",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-300",
  red: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950 dark:text-red-300",
  blue: "bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-950 dark:text-sky-300",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-950 dark:text-violet-300",
  gray: "bg-zinc-100 text-zinc-700 ring-zinc-500/20 dark:bg-zinc-800 dark:text-zinc-300",
};

export function Badge({ color = "gray", children }: { color?: keyof typeof BADGE; children: ReactNode }) {
  return <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", BADGE[color])}>{children}</span>;
}

/** One colour mapping for every status in the app (attendance, leave, payroll, users). */
export function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const color: keyof typeof BADGE =
    ["present", "approved", "active", "finalized", "ok"].includes(s) ? "green"
    : ["late", "pending", "probation", "half_day", "missing_checkout", "draft"].includes(s) ? "amber"
    : ["absent", "rejected", "inactive", "exited", "deactivated"].includes(s) ? "red"
    : ["on_leave", "cancelled", "holiday"].includes(s) ? "blue"
    : "gray";
  return <Badge color={color}>{humanize(s)}</Badge>;
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-[11px] uppercase tracking-[0.06em] text-zinc-500 dark:text-zinc-400 dark:border-zinc-800">
            {head.map((h, i) => (
              <th key={i} className="px-3 py-2.5 font-medium first:pl-4 sm:first:pl-3">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}

export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td className={cx("px-3 py-3 align-middle first:pl-4 sm:first:pl-3", className)}>{children}</td>
);

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-zinc-500 dark:text-zinc-400" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" aria-hidden />
      {label}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-zinc-50/60 px-4 py-12 text-center dark:border-zinc-700 dark:bg-zinc-900/30">
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="max-w-sm text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
      {action}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "success" | "warn" | "error"; children: ReactNode }) {
  const c = {
    info: "bg-sky-50 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
    success: "bg-teal-50 text-teal-900 dark:bg-teal-950 dark:text-teal-200",
    warn: "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
    error: "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cx("rounded-lg px-3 py-2 text-sm", c)}>
      {children}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Notice tone="error">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{message}</span>
        {onRetry && (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    </Notice>
  );
}

/** In-page dialog (never window.alert/confirm). */
export function Modal({ open, title, onClose, children, footer }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(560px,calc(100vw-2rem))] rounded-2xl glass-strong p-0 text-zinc-900 backdrop:bg-zinc-950/40 backdrop:backdrop-blur-sm dark:text-zinc-100"
    >
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">{title}</h2>
        <button onClick={onClose} aria-label="Close" className="rounded p-1 text-lg leading-none text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
          ×
        </button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto p-4">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">{footer}</div>}
    </dialog>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (id: T) => void }) {
  return (
    // Wraps instead of scrolling: on a phone a sideways-scrolling strip hid the last tabs with no hint they existed.
    <div role="tablist" className="mb-4 flex flex-wrap gap-x-1 border-b border-zinc-200 dark:border-zinc-800">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
            value === t.id ? "border-teal-600 text-teal-700 dark:text-teal-400" : "border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200",
          )}
        >
          {t.label}
          {t.count ? <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 text-xs text-amber-800 dark:bg-amber-900 dark:text-amber-200">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Previous / next paging for server-side paged lists. */
export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="mt-3 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
      <span>
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
