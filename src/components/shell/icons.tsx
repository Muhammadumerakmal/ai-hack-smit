// Small hand-drawn line icons (24×24, 1.75 stroke) so the shell doesn't depend on emoji rendering.

const PATHS: Record<string, string> = {
  "/dashboard": "M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z",
  "/employees": "M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M20 19v-1.2a3 3 0 0 0-2.2-2.9M15.5 5.2a3 3 0 0 1 0 5.6",
  "/profile": "M18 20v-1.5a4 4 0 0 0-4-4h-4a4 4 0 0 0-4 4V20M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7",
  "/attendance": "M12 21a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17M12 8v4.5l3 2",
  "/leave": "M7 4v3M17 4v3M4.5 10h15M6 6h12a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 18 20H6a1.5 1.5 0 0 1-1.5-1.5v-11A1.5 1.5 0 0 1 6 6M9 15l2 2 4-4",
  "/payroll": "M3.5 8h17v10.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5zM8.5 8V6a1.5 1.5 0 0 1 1.5-1.5h4A1.5 1.5 0 0 1 15.5 6v2M3.5 13h17",
  "/payslips": "M7 3.5h7.5L18 7v13.5H7a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1M14 3.5V7h4M9.5 12h5M9.5 15.5h5",
  "/announcements": "M4 10v4a1 1 0 0 0 1 1h2l5 4V5L7 9H5a1 1 0 0 0-1 1M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11",
  "/users": "M8 15a4 4 0 1 1 3.5-6M11.5 9 20 9M17 9v3M20 9v2.5M8 13a1 1 0 1 0 0-2",
  "/settings": "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 13.5a1.5 1.5 0 0 0 .3 1.6l.1.1a1.8 1.8 0 1 1-2.6 2.6l-.1-.1a1.5 1.5 0 0 0-2.5 1.1v.2a1.8 1.8 0 0 1-3.6 0v-.1a1.5 1.5 0 0 0-2.5-1.1l-.1.1a1.8 1.8 0 1 1-2.6-2.6l.1-.1a1.5 1.5 0 0 0-1.1-2.5h-.2a1.8 1.8 0 0 1 0-3.6h.1a1.5 1.5 0 0 0 1.1-2.5l-.1-.1a1.8 1.8 0 1 1 2.6-2.6l.1.1a1.5 1.5 0 0 0 2.5-1.1v-.2a1.8 1.8 0 0 1 3.6 0v.1a1.5 1.5 0 0 0 2.5 1.1l.1-.1a1.8 1.8 0 1 1 2.6 2.6l-.1.1a1.5 1.5 0 0 0 1.1 2.5h.2a1.8 1.8 0 0 1 0 3.6h-.1a1.5 1.5 0 0 0-1.4.9",
  "/audit": "M8 4h8a2 2 0 0 1 2 2v14l-3-2-3 2-3-2-3 2V6a2 2 0 0 1 2-2M9.5 9h5M9.5 12.5h5",
  bell: "M6 9.5a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15.5 6 9.5M10 20a2.2 2.2 0 0 0 4 0",
  menu: "M4 7h16M4 12h16M4 17h16",
  logout: "M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10",
};

export function Icon({ name, className = "h-[18px] w-[18px]" }: { name: string; className?: string }) {
  const d = PATHS[name];
  if (!d) return <span className={className} aria-hidden />;
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}
