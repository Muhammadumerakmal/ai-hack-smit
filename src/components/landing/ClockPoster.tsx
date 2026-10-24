/*
 * Static SVG version of the attendance clock. Used while the 3D scene loads, on phones,
 * when WebGL is unavailable, and as the reduced-motion fallback if the scene fails.
 */

const PEOPLE = 12;
const STATUS = ["present", "present", "late", "present", "present", "present", "leave", "present", "present", "absent", "present", "present"] as const;
// Server (Node) and browser trig can differ in the last digits; rounding keeps SSR and hydration identical.
const r2 = (n: number) => Math.round(n * 100) / 100;
const FILL: Record<(typeof STATUS)[number], string> = { present: "#2dd4bf", late: "#f59e0b", leave: "#38bdf8", absent: "#3f3f46" };

export function ClockPoster({ className = "" }: { className?: string }) {
  const cx = 200;
  const cy = 200;
  return (
    <svg viewBox="16 52 368 266" className={className} role="img" aria-label="Attendance clock: team members around a dial, checked in as the hand sweeps past">
      <defs>
        <radialGradient id="cp-dial" cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor="#1c1f24" />
          <stop offset="100%" stopColor="#0d0f12" />
        </radialGradient>
        <radialGradient id="cp-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#c4b5fd" />
          <stop offset="60%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="cp-sweep" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0" />
          <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0.22" />
        </linearGradient>
      </defs>

      {/* Dial seen at a slight angle */}
      <g transform="translate(0 30) scale(1 0.62) translate(0 70)">
        <circle cx={cx} cy={cy} r="176" fill="url(#cp-dial)" stroke="#14b8a6" strokeOpacity="0.55" strokeWidth="4" />
        {Array.from({ length: 60 }, (_, i) => {
          const a = (i / 60) * Math.PI * 2;
          const major = i % 5 === 0;
          const r1 = 160;
          const rIn = major ? 146 : 154;
          return (
            <line
              key={i}
              x1={r2(cx + Math.sin(a) * r1)}
              y1={r2(cy - Math.cos(a) * r1)}
              x2={r2(cx + Math.sin(a) * rIn)}
              y2={r2(cy - Math.cos(a) * rIn)}
              stroke={major ? "#5eead4" : "#3f3f46"}
              strokeWidth={major ? 3 : 2}
              strokeLinecap="round"
            />
          );
        })}
        <path d={`M ${cx} ${cy} L ${cx + 150} ${cy - 40} A 155 155 0 0 0 ${cx + 110} ${cy - 110} Z`} fill="url(#cp-sweep)" />
        <line x1={cx} y1={cy} x2={cx + 150} y2={cy - 40} stroke="#99f6e4" strokeWidth="5" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="24" fill="#1f2024" stroke="#27272a" strokeWidth="2" />
      </g>

      {/* People, drawn upright on top of the tilted dial */}
      {Array.from({ length: PEOPLE }, (_, i) => {
        const a = (i / PEOPLE) * Math.PI * 2;
        const x = r2(cx + Math.sin(a) * 136);
        const y = r2(30 + (cy + 70 - Math.cos(a) * 136) * 0.62);
        const s = r2(0.85 + 0.25 * ((Math.cos(a) * -1 + 1) / 2)); // nearer = larger
        const c = FILL[STATUS[i]];
        return (
          <g key={i} transform={`translate(${x} ${y}) scale(${s})`}>
            <rect x="-9" y="-30" width="18" height="30" rx="9" fill={c} opacity={STATUS[i] === "absent" ? 0.9 : 1} />
            <circle cx="0" cy="-40" r="8" fill={c} />
          </g>
        );
      })}

      <circle cx={cx} cy={30 + (cy + 70) * 0.62 - 14} r="22" fill="url(#cp-core)" />
    </svg>
  );
}
