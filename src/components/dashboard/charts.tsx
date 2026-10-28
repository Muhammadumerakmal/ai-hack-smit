"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { labelCase } from "@/components/ops/format";
import { Avatar, cx } from "./primitives";

// Lightweight inline-SVG / HTML charts (no chart library). Follows the dataviz method:
// one series per chart → one hue (teal-600, validated ≥3:1 on light and dark surfaces), no legend box
// (the panel title names the series), 2px line, 10% area wash, ≥8px end dot with a 2px surface ring,
// hairline recessive grid, value labels in text ink, hover/focus tooltips, and a table view everywhere.

const SERIES = "#0d9488";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Daily attendance rate (0–100%) as a line + area, with crosshair tooltip and arrow-key navigation. */
export function TrendChart({ points, label }: { points: { date: string; value: number }[]; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const height = width < 480 ? 190 : 230;
  const pad = { l: 40, r: 44, t: 14, b: 26 };
  const w = Math.max(0, width - pad.l - pad.r);
  const h = height - pad.t - pad.b;
  const n = points.length;
  const x = (i: number) => pad.l + (n <= 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (v: number) => pad.t + h - (Math.max(0, Math.min(100, v)) / 100) * h;

  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = n > 1 ? `${line} L${x(n - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z` : "";
  const ticks = n <= 1 ? [0] : width < 480 ? [0, n - 1] : [0, Math.floor((n - 1) / 2), n - 1];
  const last = n - 1;

  function pick(clientX: number) {
    const el = ref.current;
    if (!el || n === 0) return;
    const rel = clientX - el.getBoundingClientRect().left - pad.l;
    setActive(Math.max(0, Math.min(n - 1, Math.round(n <= 1 ? 0 : (rel / w) * (n - 1)))));
  }

  const a = active != null ? points[active] : null;

  return (
    <div
      ref={ref}
      className="relative w-full touch-pan-y select-none outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50 rounded-lg"
      tabIndex={0}
      role="img"
      aria-label={`${label}. ${n} days. Latest ${points[last]?.value ?? "no"}%. Use left and right arrow keys to read each day.`}
      onPointerMove={(e) => pick(e.clientX)}
      onPointerDown={(e) => pick(e.clientX)}
      onPointerLeave={() => setActive(null)}
      onFocus={() => setActive((i) => i ?? last)}
      onBlur={() => setActive(null)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") setActive((i) => Math.max(0, (i ?? last) - 1));
        if (e.key === "ArrowRight") setActive((i) => Math.min(last, (i ?? last) + 1));
      }}
    >
      {width > 0 && (
        <svg width={width} height={height} className="block overflow-visible">
          {[0, 50, 100].map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} className={v === 0 ? "stroke-zinc-300 dark:stroke-zinc-700" : "stroke-zinc-200/80 dark:stroke-zinc-800"} strokeWidth={1} />
              <text x={pad.l - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-zinc-500 text-[11px] dark:fill-zinc-400 tabular-nums">
                {v}%
              </text>
            </g>
          ))}
          {ticks.map((i) => (
            <text key={i} x={x(i)} y={height - 6} textAnchor={i === 0 && n > 1 ? "start" : i === last && n > 1 ? "end" : "middle"} className="fill-zinc-500 text-[11px] dark:fill-zinc-400">
              {shortDate(points[i].date)}
            </text>
          ))}
          {area && <path d={area} fill={SERIES} fillOpacity={0.1} />}
          {n > 1 && <path d={line} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          {a && active != null && <line x1={x(active)} x2={x(active)} y1={pad.t} y2={pad.t + h} className="stroke-zinc-400 dark:stroke-zinc-500" strokeWidth={1} />}
          {n > 0 && (
            <>
              <circle cx={x(active ?? last)} cy={y(points[active ?? last].value)} r={5} fill={SERIES} className="stroke-white dark:stroke-zinc-900" strokeWidth={2} />
              {active == null && (
                <text x={x(last) + 9} y={y(points[last].value)} dy="0.32em" className="fill-zinc-700 text-[11px] font-semibold tabular-nums dark:fill-zinc-200">
                  {points[last].value}%
                </text>
              )}
            </>
          )}
        </svg>
      )}
      {a && active != null && (
        <div
          className="pointer-events-none absolute top-1 z-10 min-w-[8.5rem] -translate-x-1/2 rounded-lg border border-zinc-200 bg-white px-3 py-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          style={{ left: Math.min(Math.max(x(active), 72), Math.max(72, width - 72)) }}
          role="status"
        >
          <p className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{a.value}%</p>
          <p className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            <span className="inline-block h-0.5 w-3 rounded" style={{ background: SERIES }} aria-hidden />
            {longDate(a.date)}
          </p>
        </div>
      )}
    </div>
  );
}

export interface BarItem {
  label: string;
  value: number;
  /** secondary context shown under the label (e.g. "42% of quota") */
  note?: string;
}

/** Horizontal bars: label · bar from a shared baseline · value. Single series, one hue. */
export function BarChart({ items, max, format = (n) => String(n), empty }: { items: BarItem[]; max?: number; format?: (n: number) => string; empty?: ReactNode }) {
  const [hover, setHover] = useState<string | null>(null);
  if (!items.length) return <>{empty}</>;
  const top = max ?? Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="space-y-1">
      {items.map((i) => {
        const pct = top > 0 ? Math.max(0, Math.min(100, (i.value / top) * 100)) : 0;
        return (
          <li
            key={i.label}
            tabIndex={0}
            aria-label={`${i.label}: ${format(i.value)}${i.note ? `, ${i.note}` : ""}`}
            onPointerEnter={() => setHover(i.label)}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(i.label)}
            onBlur={() => setHover(null)}
            className={cx(
              "grid min-h-10 grid-cols-[minmax(0,38%)_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-teal-500/50",
              hover === i.label && "bg-zinc-50 dark:bg-zinc-800/50",
            )}
          >
            <span className="min-w-0">
              <span className="line-clamp-2 break-words text-[13px] leading-snug text-zinc-700 dark:text-zinc-300" title={i.label}>
                {labelCase(i.label)}
              </span>
              {i.note && <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">{i.note}</span>}
            </span>
            <span className="relative h-2.5" aria-hidden>
              {/* square at the baseline, 4px rounded data end; a zero value keeps a hairline stub */}
              <span
                className="absolute inset-y-0 left-0 rounded-r-[4px] transition-[width,opacity] duration-500"
                style={{ width: pct > 0 ? `max(${pct}%, 3px)` : "2px", background: pct > 0 ? SERIES : "rgb(161 161 170 / .5)", opacity: hover && hover !== i.label ? 0.55 : 1 }}
              />
            </span>
            <span className="text-right text-[13px] font-medium tabular-nums text-zinc-900 dark:text-zinc-100">{format(i.value)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** The same data as a compact table (the chart's accessible twin). */
export function DataTable({ rows, head }: { rows: (string | number)[][]; head: string[] }) {
  return (
    <div className="max-h-72 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-left text-[13px]">
        <thead className="sticky top-0 bg-white/85 text-[11px] uppercase tracking-[0.06em] text-zinc-500 backdrop-blur-md dark:bg-zinc-900/85 dark:text-zinc-400">
          <tr>
            {head.map((h, i) => (
              <th key={h} className={cx("px-3 py-2 font-medium", i > 0 && "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, ci) => (
                <td key={ci} className={cx("px-3 py-2", ci > 0 ? "text-right tabular-nums" : "text-zinc-700 dark:text-zinc-300")}>
                  {ci === 0 && typeof c === "string" ? labelCase(c) : c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Ranked people list (e.g. top late-comers): rank · avatar · name/department · count with a proportional bar. */
export function RankedList({ items, unit }: { items: { name: string; sub: string; value: number }[]; unit: string }) {
  const top = Math.max(...items.map((i) => i.value), 1);
  return (
    <ol className="space-y-1">
      {items.map((i, idx) => (
        <li key={`${i.name}-${idx}`} className="flex min-h-12 items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
          <span className="w-4 text-center text-xs font-semibold tabular-nums text-zinc-500 dark:text-zinc-400">{idx + 1}</span>
          <Avatar name={i.name} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-100">{i.name}</span>
            <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">{i.sub}</span>
            <span className="mt-1 block h-1.5 rounded-r-[4px]" style={{ width: `${Math.max(6, (i.value / top) * 100)}%`, background: SERIES }} aria-hidden />
          </span>
          <span className="shrink-0 text-right">
            <span className="block text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{i.value}</span>
            <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">{unit}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
