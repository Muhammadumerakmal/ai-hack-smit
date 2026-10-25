"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { AiChatPanel } from "@/components/ai/AiChatPanel";
import { Loading } from "@/components/ui";
import { api, fmtDateTime, useApi } from "@/lib/client";
import { Icon } from "./icons";
import { LogoMark } from "./Logo";

export type Role = "ADMIN" | "HR" | "EMPLOYEE";
export interface Me {
  userId: string;
  name: string;
  email: string;
  role: Role;
  employeeId: string | null;
  mustChangePassword: boolean;
  companyName: string;
}

const MeContext = createContext<Me | null>(null);

/** The signed-in user, available to every page inside the app shell. */
export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe must be used inside AppShell");
  return me;
}

interface NavItem {
  href: string;
  label: string;
  icon: string;
  roles: Role[];
  /** only for users linked to an employee record */
  needsEmployee?: boolean;
}

// One menu per role (checklist #02). The server enforces access; this only decides what is shown.
export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "▦", roles: ["ADMIN", "HR", "EMPLOYEE"] },
  { href: "/employees", label: "Employees", icon: "👥", roles: ["ADMIN", "HR"] },
  { href: "/profile", label: "My profile", icon: "👤", roles: ["HR", "EMPLOYEE"], needsEmployee: true },
  { href: "/attendance", label: "Attendance", icon: "🕘", roles: ["ADMIN", "HR", "EMPLOYEE"] },
  { href: "/leave", label: "Leave", icon: "🌴", roles: ["ADMIN", "HR", "EMPLOYEE"] },
  { href: "/payroll", label: "Payroll", icon: "💼", roles: ["ADMIN", "HR"] },
  { href: "/payslips", label: "Payslips", icon: "🧾", roles: ["ADMIN", "HR", "EMPLOYEE"] },
  { href: "/announcements", label: "Announcements", icon: "📣", roles: ["ADMIN", "HR", "EMPLOYEE"] },
  { href: "/users", label: "Users & logins", icon: "🔑", roles: ["ADMIN"] },
  { href: "/settings", label: "Company setup", icon: "⚙", roles: ["ADMIN", "HR"] },
  { href: "/audit", label: "Audit log", icon: "📜", roles: ["ADMIN"] },
];

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    api<Me>("/api/auth/me")
      .then((m) => (m.mustChangePassword ? router.replace("/change-password") : setMe(m)))
      .catch(() => router.replace("/login"));
  }, [router]);

  if (!me) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loading label="Signing you in…" />
      </div>
    );
  }

  const items = NAV.filter((n) => n.roles.includes(me.role) && (!n.needsEmployee || me.employeeId));

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    // Full reload on purpose: clears every bit of the previous user's client state.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/login";
  }

  return (
    <MeContext.Provider value={me}>
      <div className="flex min-h-screen bg-background">
        <aside
          className={`fixed inset-y-0 left-0 z-30 flex w-64 shrink-0 transform flex-col border-r border-zinc-200/80 bg-white transition-transform duration-300 dark:border-zinc-800/80 dark:bg-zinc-950 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
            menuOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex h-16 items-center gap-2.5 px-5">
            <LogoMark />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold tracking-tight">HCM Lite</p>
              <p className="truncate text-[11px] text-zinc-500">{me.companyName}</p>
            </div>
          </div>
          <p className="px-5 pb-2 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">Workspace</p>
          <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4" aria-label="Main">
            {items.map((n) => {
              const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  onClick={() => setMenuOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                    active
                      ? "bg-teal-50 font-medium text-teal-800 dark:bg-teal-500/10 dark:text-teal-300"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
                  }`}
                >
                  {active && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-teal-600 dark:bg-teal-400" aria-hidden />}
                  <Icon name={n.href} className={`h-[18px] w-[18px] ${active ? "" : "text-zinc-400 group-hover:text-zinc-600 dark:text-zinc-500 dark:group-hover:text-zinc-300"}`} />
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="border-t border-zinc-200/80 px-5 py-4 text-[11px] text-zinc-400 dark:border-zinc-800/80 dark:text-zinc-500">
            {me.companyName} · <span className="font-medium text-zinc-600 dark:text-zinc-300">{roleLabel(me.role)}</span> workspace
          </div>
        </aside>
        {menuOpen && <div className="fixed inset-0 z-20 bg-zinc-950/40 backdrop-blur-[2px] lg:hidden" onClick={() => setMenuOpen(false)} />}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-2 border-b border-zinc-200/80 bg-white/80 px-4 backdrop-blur-md sm:px-6 dark:border-zinc-800/80 dark:bg-zinc-950/80">
            <button className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 lg:hidden dark:text-zinc-300 dark:hover:bg-zinc-900" onClick={() => setMenuOpen(true)} aria-label="Open menu">
              <Icon name="menu" className="h-5 w-5" />
            </button>
            <div className="flex-1" />
            <NotificationBell />
            <div className="ml-1 flex items-center gap-2.5 border-l border-zinc-200 pl-3 dark:border-zinc-800">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-100 text-xs font-semibold text-teal-800 dark:bg-teal-500/15 dark:text-teal-300" aria-hidden>
                {initials(me.name)}
              </span>
              <div className="hidden leading-tight sm:block">
                <p className="text-sm font-medium">{me.name}</p>
                <p className="text-[11px] text-zinc-500">{roleLabel(me.role)}</p>
              </div>
            </div>
            <button
              onClick={logout}
              className="ml-1 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
              aria-label="Sign out"
            >
              <Icon name="logout" className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </header>
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-8 sm:px-6">{children}</main>
        </div>
        <AiChatPanel role={me.role} />
      </div>
    </MeContext.Provider>
  );
}

interface NotificationList {
  unread: number;
  items: { id: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string }[];
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data, error, loading, reload } = useApi<NotificationList>("/api/notifications");
  const [readError, setReadError] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(reload, 60_000);
    return () => clearInterval(t);
  }, [reload]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && data?.unread) {
      setReadError(null);
      try {
        await api("/api/notifications/read", { method: "POST", body: {} });
        reload();
      } catch (error) {
        setReadError((error as Error).message);
      }
    }
  }

  return (
    <div className="relative">
      <button
        onClick={toggle}
        aria-label={`Notifications${data?.unread ? `, ${data.unread} unread` : ""}`}
        aria-expanded={open}
        className="relative rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
      >
        <Icon name="bell" className="h-5 w-5" />
        {!!data?.unread && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white ring-2 ring-white dark:ring-zinc-950">{data.unread}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
          <p className="border-b border-zinc-200 px-3 py-2 text-xs font-semibold dark:border-zinc-800">Notifications</p>
          {readError && <p role="alert" className="border-b border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{readError}</p>}
          <ul className="max-h-80 divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-900">
            {error ? (
              <li className="px-3 py-4 text-center text-xs text-red-700 dark:text-red-300">
                <p role="alert">{error}</p>
                <button type="button" onClick={reload} className="mt-2 font-medium underline">
                  Retry
                </button>
              </li>
            ) : loading && !data ? (
              <li role="status" className="px-3 py-6 text-center text-xs text-zinc-500">Loading notifications…</li>
            ) : data && !data.items.length ? (
              <li className="px-3 py-6 text-center text-xs text-zinc-500">Nothing new.</li>
            ) : null}
            {data?.items.map((n) => {
              const content = (
                <>
                  <p className="text-sm font-medium">{n.title}</p>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">{n.body}</p>
                  <p className="mt-0.5 text-[11px] text-zinc-400">{fmtDateTime(n.createdAt)}</p>
                </>
              );
              const className = "block px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-900";

              return (
                <li key={n.id}>
                  {n.link ? (
                    <Link href={n.link} onClick={() => setOpen(false)} className={className}>
                      {content}
                    </Link>
                  ) : (
                    <div className={className}>{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

const roleLabel = (role: Role) => (role === "HR" ? "HR" : role.charAt(0) + role.slice(1).toLowerCase());

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "?"
  );
}
