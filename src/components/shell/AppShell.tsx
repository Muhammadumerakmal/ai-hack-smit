"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { AiChatPanel } from "@/components/ai/AiChatPanel";
import { Loading } from "@/components/ui";
import { api, fmtDateTime, useApi } from "@/lib/client";

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
      <div className="flex min-h-screen bg-zinc-50 dark:bg-black">
        <aside
          className={`fixed inset-y-0 left-0 z-30 w-60 shrink-0 transform border-r border-zinc-200 bg-white transition-transform dark:border-zinc-800 dark:bg-zinc-950 lg:static lg:translate-x-0 ${
            menuOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex h-14 items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-600 text-xs font-bold text-white">HC</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">HCM Lite</p>
              <p className="truncate text-[11px] text-zinc-500">{me.companyName}</p>
            </div>
          </div>
          <nav className="space-y-0.5 p-2" aria-label="Main">
            {items.map((n) => {
              const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  onClick={() => setMenuOpen(false)}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${
                    active ? "bg-teal-50 font-medium text-teal-800 dark:bg-teal-950 dark:text-teal-300" : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  }`}
                >
                  <span aria-hidden className="w-4 text-center">
                    {n.icon}
                  </span>
                  {n.label}
                </Link>
              );
            })}
          </nav>
        </aside>
        {menuOpen && <div className="fixed inset-0 z-20 bg-black/30 lg:hidden" onClick={() => setMenuOpen(false)} />}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-2 border-b border-zinc-200 bg-white/90 px-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
            <button className="rounded-lg p-2 hover:bg-zinc-100 lg:hidden dark:hover:bg-zinc-900" onClick={() => setMenuOpen(true)} aria-label="Open menu">
              ☰
            </button>
            <div className="flex-1" />
            <NotificationBell />
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight">{me.name}</p>
              <p className="text-[11px] text-zinc-500">{me.role === "HR" ? "HR" : me.role.charAt(0) + me.role.slice(1).toLowerCase()}</p>
            </div>
            <button onClick={logout} className="rounded-lg px-2.5 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900">
              Sign out
            </button>
          </header>
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
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
  const { data, reload } = useApi<NotificationList>("/api/notifications");

  useEffect(() => {
    const t = setInterval(reload, 60_000);
    return () => clearInterval(t);
  }, [reload]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && data?.unread) {
      await api("/api/notifications/read", { method: "POST", body: {} }).catch(() => {});
      reload();
    }
  }

  return (
    <div className="relative">
      <button onClick={toggle} aria-label={`Notifications${data?.unread ? `, ${data.unread} unread` : ""}`} className="relative rounded-lg p-2 hover:bg-zinc-100 dark:hover:bg-zinc-900">
        🔔
        {!!data?.unread && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">{data.unread}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
          <p className="border-b border-zinc-200 px-3 py-2 text-xs font-semibold dark:border-zinc-800">Notifications</p>
          <ul className="max-h-80 divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-900">
            {!data?.items.length && <li className="px-3 py-6 text-center text-xs text-zinc-500">Nothing new.</li>}
            {data?.items.map((n) => (
              <li key={n.id}>
                <Link href={n.link ?? "#"} onClick={() => setOpen(false)} className="block px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-900">
                  <p className="text-sm font-medium">{n.title}</p>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">{n.body}</p>
                  <p className="mt-0.5 text-[11px] text-zinc-400">{fmtDateTime(n.createdAt)}</p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
