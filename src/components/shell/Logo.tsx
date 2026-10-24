/** Brand mark: a dial with one hand, the same idea as the entry-screen scene. */
export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" fill="#0f766e" />
      <circle cx="16" cy="16" r="9.5" fill="none" stroke="#5eead4" strokeWidth="2" />
      <path d="M16 16 L22.5 11.5" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="16" cy="16" r="2.2" fill="#c4b5fd" />
    </svg>
  );
}

export function Wordmark({ sub, tone = "default" }: { sub?: string; tone?: "default" | "light" }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      <div className="min-w-0 leading-tight">
        <p className={`truncate text-sm font-semibold tracking-tight ${tone === "light" ? "text-white" : ""}`}>HCM Lite</p>
        {sub && <p className={`truncate text-[11px] ${tone === "light" ? "text-zinc-400" : "text-zinc-500"}`}>{sub}</p>}
      </div>
    </div>
  );
}
