import type { ReactNode } from "react";
import { EntryHero } from "@/components/landing/EntryHero";
import { Wordmark } from "./Logo";

const LEGEND = [
  { label: "Present", color: "bg-teal-400" },
  { label: "Late", color: "bg-amber-400" },
  { label: "On leave", color: "bg-sky-400" },
  { label: "AI assistant", color: "bg-violet-400" },
];

const FACTS = [
  { title: "Attendance", body: "Web check-in with late, half-day and absence rules applied on the server." },
  { title: "Leave & payroll", body: "Approvals, balances, monthly payroll and payslip PDFs." },
  { title: "AI assistant", body: "Answers from your own records, scoped to each role." },
];

/** Entry screens (setup, sign in, change password): cinematic scene on the left, the form on the right. */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="grid min-h-screen bg-background lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      {/* Story panel */}
      <section className="relative isolate overflow-hidden bg-[#0b0d10] text-white lg:min-h-screen" aria-label="About HCM Lite">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_30%_20%,rgba(20,184,166,0.16),transparent_55%),radial-gradient(ellipse_at_80%_90%,rgba(124,58,237,0.10),transparent_50%)]" />
        <div className="relative h-60 pt-14 sm:h-80 lg:absolute lg:inset-0 lg:h-auto lg:pt-0">
          <EntryHero />
        </div>
        {/* Legibility scrims over the scene */}
        <div className="pointer-events-none absolute inset-x-0 top-0 hidden h-40 bg-gradient-to-b from-[#0b0d10] to-transparent lg:block" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-[46%] bg-gradient-to-t from-[#0b0d10] via-[#0b0d10]/85 to-transparent lg:block" />

        <div className="absolute left-6 top-6 lg:left-10 lg:top-9">
          <Wordmark sub="AI-assisted HR" tone="light" />
        </div>

        <div className="relative px-6 pb-8 pt-2 lg:absolute lg:inset-x-0 lg:bottom-0 lg:px-10 lg:pb-10">
          <p className="animate-rise text-xs font-medium uppercase tracking-[0.18em] text-teal-300/90 [animation-delay:150ms]">
            For Admin, HR and Employees
          </p>
          <h2 className="mt-3 max-w-xl animate-rise text-2xl font-semibold leading-[1.15] tracking-tight text-balance [animation-delay:250ms] sm:text-3xl lg:text-[2.6rem]">
            Your whole team on one clock, from check-in to payslip.
          </h2>
          <p className="mt-3 hidden max-w-lg animate-rise text-sm leading-relaxed text-zinc-400 [animation-delay:350ms] sm:block">
            Attendance, leave, payroll and dashboards in one place, with an assistant that only answers from your company&apos;s records.
          </p>

          <ul className="mt-7 hidden max-w-2xl animate-rise grid-cols-3 gap-5 border-t border-white/10 pt-6 [animation-delay:450ms] lg:grid">
            {FACTS.map((f) => (
              <li key={f.title}>
                <p className="text-sm font-medium text-zinc-100">{f.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-zinc-400">{f.body}</p>
              </li>
            ))}
          </ul>

          <ul className="mt-5 flex animate-rise flex-wrap gap-x-4 gap-y-1.5 [animation-delay:550ms]" aria-label="Scene legend">
            {LEGEND.map((l) => (
              <li key={l.label} className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                <span className={`h-2 w-2 rounded-full ${l.color}`} aria-hidden />
                {l.label}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Form panel */}
      <section className="flex items-start justify-center px-4 py-10 sm:px-8 lg:items-center lg:py-12">
        <div className="w-full max-w-[400px] animate-rise [animation-delay:200ms]">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
          <div className="mt-7">{children}</div>
          <p className="mt-10 text-[11px] text-zinc-500 dark:text-zinc-400">Saylani Hackathon 2026 · HCM Lite</p>
        </div>
      </section>
    </main>
  );
}
