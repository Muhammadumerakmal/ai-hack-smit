import type { PayslipDetail } from "./services/payroll.service";

// A tiny, dependency-free PDF 1.4 writer: one A4 page, Helvetica / Helvetica-Bold text and straight lines.
// Enough for a payslip; avoids pulling a PDF library into the bundle.

interface TextOp {
  x: number;
  y: number;
  text: string;
  size?: number;
  bold?: boolean;
  /** right-align at x */
  right?: boolean;
}
interface LineOp {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width?: number;
}

const PAGE_W = 595;
const PAGE_H = 842;

// Standard Helvetica advance widths are not embedded; approximate for right alignment (0.5 em per char, digits ~0.556).
const approxWidth = (s: string, size: number) => [...s].reduce((w, c) => w + (/[0-9]/.test(c) ? 0.556 : c === " " ? 0.278 : 0.5), 0) * size;

function escapeText(s: string): string {
  // ASCII only (standard fonts, WinAnsi); escape PDF string delimiters.
  return s.replace(/[^\x20-\x7e]/g, "?").replace(/([\\()])/g, "\\$1");
}

export function buildPdf(texts: TextOp[], lines: LineOp[] = []): ArrayBuffer {
  const content = [
    ...lines.map((l) => `${l.width ?? 0.8} w ${l.x1} ${l.y1} m ${l.x2} ${l.y2} l S`),
    ...texts.map((t) => {
      const size = t.size ?? 10;
      const x = t.right ? t.x - approxWidth(t.text, size) : t.x;
      return `BT /${t.bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${t.y} Td (${escapeText(t.text)}) Tj ET`;
    }),
  ].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];

  // Everything is ASCII, so string length == byte length for the xref offsets.
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  const bytes = new Uint8Array(new ArrayBuffer(out.length));
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i);
  return bytes.buffer;
}

const rs = (n: number) => `Rs ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function renderPayslipPdf(p: PayslipDetail): ArrayBuffer {
  const L = 60;
  const R = PAGE_W - 60;
  const t: TextOp[] = [];
  const lines: LineOp[] = [];

  t.push({ x: L, y: 780, text: p.companyName, size: 18, bold: true });
  t.push({ x: L, y: 760, text: `Payslip - ${monthLabel(p.month)}${p.status === "DRAFT" ? " (DRAFT)" : ""}`, size: 12 });
  lines.push({ x1: L, y1: 745, x2: R, y2: 745, width: 1.2 });

  const info: [string, string][] = [
    ["Employee", `${p.employee.name} (${p.employee.code})`],
    ["Department", p.employee.department],
    ["Designation", p.employee.designation ?? "-"],
    ["Working days", String(p.workingDays)],
    ["Paid days", String(p.paidDays)],
    ...(p.latePenaltyDays ? ([["Late penalty", `${p.latePenaltyDays} day (${p.lateDays} late days, 0.5 day per 3)`]] as [string, string][]) : []),
  ];
  info.forEach(([k, v], i) => {
    t.push({ x: L, y: 720 - i * 18, text: k, size: 10, bold: true });
    t.push({ x: L + 110, y: 720 - i * 18, text: v, size: 10 });
  });

  let y = 610;
  t.push({ x: L, y, text: "Earnings", size: 11, bold: true });
  t.push({ x: R, y, text: "Amount", size: 11, bold: true, right: true });
  lines.push({ x1: L, y1: y - 6, x2: R, y2: y - 6 });
  const rows: [string, number, boolean?][] = [
    ["Basic salary", p.basic],
    ["House rent allowance (40%)", p.hra],
    ["Medical allowance (10%)", p.medical],
    ["Gross salary", p.gross, true],
    [`Deductions (absence, unpaid leave, half days${p.latePenaltyDays ? ", late penalty" : ""})`, -p.deductions],
    ["Income tax", -p.tax],
  ];
  for (const [label, amount, bold] of rows) {
    y -= 20;
    t.push({ x: L, y, text: label, size: 10, bold });
    t.push({ x: R, y, text: amount < 0 ? `- ${rs(-amount)}` : rs(amount), size: 10, bold, right: true });
  }
  y -= 14;
  lines.push({ x1: L, y1: y, x2: R, y2: y, width: 1.2 });
  y -= 22;
  t.push({ x: L, y, text: "Net pay", size: 13, bold: true });
  t.push({ x: R, y, text: rs(p.net), size: 13, bold: true, right: true });

  t.push({ x: L, y: 80, text: "Generated by HCM Lite. Gross = 1.5 x basic; tax per the illustrative slab on annualised earned gross.", size: 8 });
  return buildPdf(t, lines);
}
