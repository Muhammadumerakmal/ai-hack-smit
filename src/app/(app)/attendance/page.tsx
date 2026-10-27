"use client";

import { useMemo, useState } from "react";
import { CheckInWidget } from "@/components/attendance/CheckInWidget";
import { companyMonth, companyToday, fmtDuration, humanize, minutesBetween, monthLabel, weekdayShort } from "@/components/ops/format";
import { OpsIcon } from "@/components/ops/icons";
import {
  Banner,
  cx,
  DataList,
  DOT,
  EmptyBlock,
  KpiTile,
  ListSkeleton,
  MonthSwitcher,
  Panel,
  PersonCell,
  SegmentedTabs,
  Skeleton,
  StatusPill,
  TilesSkeleton,
  toneOf,
  type Column,
  type Tone,
} from "@/components/ops/primitives";
import { useMe } from "@/components/shell/AppShell";
import { Badge, Button, ErrorState, Field, Input, Modal, Notice, PageHeader, Select, Textarea } from "@/components/ui";
import { api, fmtDate, fmtTime, qs, useApi } from "@/lib/client";

interface CalendarDay {
  date: string;
  kind: string;
  holiday: string | null;
  checkIn: string | null;
  checkOut: string | null;
}
interface Calendar {
  month: string;
  days: CalendarDay[];
  attendanceRatePct: number | null;
  latePct?: number | null;
  counts: Record<string, number>;
}
interface Correction {
  id: string;
  employeeId: string;
  employee: { name: string; code: string; department: string } | null;
  date: string;
  checkIn: string;
  checkOut: string | null;
  reason: string;
  status: string;
  comment: string | null;
}
interface BoardRow {
  employeeId: string;
  name: string;
  code: string;
  department: string;
  status: string;
  checkIn: string | null;
  checkOut: string | null;
  source?: string | null;
  distanceMeters?: number | null;
}
interface Board {
  date: string;
  isWorkingDay: boolean;
  holiday: string | null;
  summary: Record<string, number>;
  rows: BoardRow[];
}

export default function AttendancePage() {
  const me = useMe();
  const isStaff = me.role === "ADMIN" || me.role === "HR";
  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        subtitle={
          isStaff
            ? "Today's board, monthly records and correction requests for the whole team."
            : "Check in and out, review your month and ask HR to fix a wrong day."
        }
      />
      {me.employeeId && <MyAttendance />}
      {isStaff && <DailyBoard />}
      {isStaff && <CorrectionsInbox canDecide={me.role === "HR"} myEmployeeId={me.employeeId} />}
    </div>
  );
}

// ---------------------------------------------------------------- employee view

function MyAttendance() {
  const [month, setMonth] = useState(companyMonth());
  const cal = useApi<Calendar>(`/api/attendance/calendar${qs({ month })}`);
  const mine = useApi<{ items: Correction[] }>("/api/attendance/corrections");
  const [correctFor, setCorrectFor] = useState<CalendarDay | "new" | null>(null);
  const counts = cal.data?.counts ?? {};

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <CheckInWidget onChange={cal.reload} />

        <Panel
          icon="calendar"
          title={`${monthLabel(month)} at a glance`}
          subtitle="Working days so far, worked out on the server from your check-ins and approved leave."
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {cal.loading && !cal.data ? (
              <TilesSkeleton count={6} />
            ) : (
              <>
                <KpiTile
                  label="Attendance rate"
                  value={cal.data?.attendanceRatePct != null ? `${cal.data.attendanceRatePct}%` : "—"}
                  tone={cal.data?.attendanceRatePct == null ? "default" : cal.data.attendanceRatePct >= 90 ? "good" : "warn"}
                  icon="percent"
                />
                <KpiTile label="Present" value={counts.present ?? 0} tone="good" />
                <KpiTile label="Late" value={counts.late ?? 0} tone={counts.late ? "warn" : "default"} />
                <KpiTile label="Half days" value={counts.half_day ?? 0} hint={counts.missing_checkout ? `${counts.missing_checkout} missing check-out` : undefined} />
                <KpiTile label="Absent" value={counts.absent ?? 0} tone={counts.absent ? "bad" : "default"} />
                <KpiTile label="On leave" value={counts.on_leave ?? 0} tone="info" />
              </>
            )}
          </div>
        </Panel>
      </div>

      <Panel
        icon="clock"
        title="My month"
        subtitle="Tap a past day to ask HR for a correction."
        actions={
          <>
            <MonthSwitcher value={month} onChange={setMonth} max={companyMonth()} />
            <Button variant="secondary" onClick={() => setCorrectFor("new")} className="w-full sm:w-auto">
              <OpsIcon name="edit" /> Request correction
            </Button>
          </>
        }
      >
        {cal.error ? (
          <ErrorState message={cal.error} onRetry={cal.reload} />
        ) : (
          <MonthCalendar month={month} days={cal.data?.month === month ? cal.data.days : null} onPick={(d) => setCorrectFor(d)} />
        )}
      </Panel>

      <Panel icon="edit" title="My correction requests" subtitle="HR approves or rejects each request; approved times replace the day's record." flush>
        {mine.loading && !mine.data ? (
          <ListSkeleton rows={2} />
        ) : mine.error ? (
          <div className="p-5">
            <ErrorState message={mine.error} onRetry={mine.reload} />
          </div>
        ) : mine.data?.items.length ? (
          <CorrectionList items={mine.data.items} showEmployee={false} />
        ) : (
          <EmptyBlock title="No correction requests" hint="If a day looks wrong, tap it in the calendar above and tell HR what happened." />
        )}
      </Panel>

      <CorrectionModal
        target={correctFor}
        onClose={() => setCorrectFor(null)}
        onDone={() => {
          mine.reload();
        }}
      />
    </div>
  );
}

const CELL: Record<Tone, string> = {
  teal: "bg-teal-50 dark:bg-teal-500/10",
  amber: "bg-amber-50 dark:bg-amber-500/10",
  orange: "bg-orange-50 dark:bg-orange-500/10",
  yellow: "bg-yellow-50 dark:bg-yellow-500/10",
  red: "bg-red-50 dark:bg-red-500/10",
  sky: "bg-sky-50 dark:bg-sky-500/10",
  indigo: "bg-indigo-50 dark:bg-indigo-500/10",
  zinc: "bg-zinc-50 dark:bg-zinc-900/60",
};

const LEGEND = ["present", "late", "half_day", "missing_checkout", "absent", "on_leave", "holiday"];
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function MonthCalendar({ month, days, onPick }: { month: string; days: CalendarDay[] | null; onPick: (d: CalendarDay) => void }) {
  const today = companyToday();
  const [y, m] = month.split("-").map(Number);
  // Monday-first offset of the 1st of the month.
  const offset = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 sm:gap-2">
        {WEEK.map((w) => (
          <div key={w} className="pb-1 text-center text-[11px] font-medium uppercase tracking-[0.06em] text-zinc-500 dark:text-zinc-400">
            <span className="sm:hidden">{w[0]}</span>
            <span className="hidden sm:inline">{w}</span>
          </div>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <div key={`pad-${i}`} aria-hidden />
        ))}
        {days
          ? days.map((d) => {
              const kind = d.holiday ? "holiday" : d.kind;
              const tone = toneOf(kind);
              const quiet = kind === "weekend" || kind === "future" || kind === "not_employed";
              const pickable = d.date <= today && kind !== "weekend" && kind !== "not_employed";
              const isToday = d.date === today;
              const label = `${fmtDate(d.date)}: ${d.holiday ?? humanize(kind)}${d.checkIn ? `, in ${fmtTime(d.checkIn)}` : ""}${d.checkOut ? `, out ${fmtTime(d.checkOut)}` : ""}`;
              const body = (
                <>
                  <span className="flex items-center justify-between">
                    <span className={cx("text-xs font-semibold tabular-nums sm:text-sm", isToday && "flex h-5 w-5 items-center justify-center rounded-full bg-teal-600 text-white sm:h-6 sm:w-6")}>
                      {Number(d.date.slice(8))}
                    </span>
                    {!quiet && <span className={cx("h-1.5 w-1.5 rounded-full sm:hidden", DOT[tone])} aria-hidden />}
                  </span>
                  {!quiet && (
                    <span className="mt-auto hidden min-w-0 text-left sm:block">
                      <span className="flex items-center gap-1 truncate text-[11px] font-medium text-zinc-700 dark:text-zinc-200">
                        <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", DOT[tone])} aria-hidden />
                        <span className="truncate">{d.holiday ?? humanize(kind)}</span>
                      </span>
                      {d.checkIn && (
                        <span className="hidden truncate text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400 lg:block">
                          {fmtTime(d.checkIn)}
                          {d.checkOut ? `–${fmtTime(d.checkOut)}` : ""}
                        </span>
                      )}
                    </span>
                  )}
                </>
              );
              const cls = cx(
                "flex min-h-11 min-w-0 flex-col rounded-lg p-1.5 ring-1 ring-inset sm:min-h-20 sm:p-2",
                quiet ? "text-zinc-500 ring-zinc-100 dark:text-zinc-400 dark:ring-zinc-800/60" : cx(CELL[tone], "ring-zinc-200/60 dark:ring-zinc-700/40"),
                kind === "weekend" && "bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,rgba(113,113,122,0.06)_6px,rgba(113,113,122,0.06)_7px)]",
                isToday && "ring-2 ring-teal-500 dark:ring-teal-400",
              );
              return pickable ? (
                <button key={d.date} type="button" onClick={() => onPick(d)} title={label} aria-label={label} className={cx(cls, "transition hover:ring-teal-400 focus-visible:ring-2 focus-visible:ring-teal-500")}>
                  {body}
                </button>
              ) : (
                <div key={d.date} title={label} aria-label={label} className={cls}>
                  {body}
                </div>
              );
            })
          : Array.from({ length: 30 }, (_, i) => <Skeleton key={i} className="min-h-11 rounded-lg sm:min-h-20" />)}
      </div>

      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2" aria-label="Legend">
        {LEGEND.map((k) => (
          <li key={k} className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
            <span className={cx("h-2 w-2 rounded-full", DOT[toneOf(k)])} aria-hidden />
            {humanize(k)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CorrectionModal({ target, onClose, onDone }: { target: CalendarDay | "new" | null; onClose: () => void; onDone: () => void }) {
  const day = target && target !== "new" ? target : null;
  // Re-mount the form for each opening so it starts from the picked day.
  const key = target === null ? "closed" : day ? day.date : "new";
  return (
    <Modal open={target !== null} title="Request an attendance correction" onClose={onClose}>
      {target !== null && <CorrectionForm key={key} day={day} onClose={onClose} onDone={onDone} />}
    </Modal>
  );
}

function CorrectionForm({ day, onClose, onDone }: { day: CalendarDay | null; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ date: day?.date ?? "", checkIn: "09:00", checkOut: "", reason: "" });
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/attendance/corrections", { body: { ...form, checkOut: form.checkOut || null } });
      setMsg({ tone: "success", text: "Sent to HR for approval." });
      onDone();
      setTimeout(onClose, 900);
    } catch (err) {
      setMsg({ tone: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {day && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-zinc-50 px-3 py-2.5 text-[13px] dark:bg-zinc-900">
          <span className="font-medium">
            {weekdayShort(day.date)}, {fmtDate(day.date)}
          </span>
          <StatusPill status={day.holiday ? "holiday" : day.kind} />
          <span className="text-zinc-500 dark:text-zinc-400">
            Recorded: in {fmtTime(day.checkIn)} · out {fmtTime(day.checkOut)}
          </span>
        </div>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Date">
          <Input type="date" required max={companyToday()} value={form.date} onChange={set("date")} />
        </Field>
        <Field label="Actual check-in">
          <Input type="time" required value={form.checkIn} onChange={set("checkIn")} />
        </Field>
        <Field label="Actual check-out" hint="Optional">
          <Input type="time" value={form.checkOut} onChange={set("checkOut")} />
        </Field>
      </div>
      <Field label="Reason" hint="HR sees this when deciding.">
        <Textarea required minLength={3} maxLength={300} rows={3} value={form.reason} onChange={set("reason")} placeholder="e.g. Forgot to check out after the client meeting" />
      </Field>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={busy}>
          Send to HR
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- shared correction list

function CorrectionList({ items, showEmployee, actions }: { items: Correction[]; showEmployee: boolean; actions?: (c: Correction) => React.ReactNode }) {
  const columns: Column<Correction>[] = [
    ...(showEmployee
      ? [
          {
            key: "emp",
            header: "Employee",
            hideOnMobile: true,
            cell: (c: Correction) => <PersonCell name={c.employee?.name ?? "—"} meta={c.employee ? `${c.employee.code} · ${c.employee.department}` : undefined} />,
          },
        ]
      : []),
    { key: "date", header: "Day", cell: (c) => <span className="whitespace-nowrap">{`${weekdayShort(c.date)}, ${fmtDate(c.date)}`}</span> },
    { key: "in", header: "In", cell: (c) => <span className="tabular-nums">{fmtTime(c.checkIn)}</span> },
    { key: "out", header: "Out", cell: (c) => <span className="tabular-nums">{fmtTime(c.checkOut)}</span> },
    {
      key: "reason",
      header: "Reason",
      className: "max-w-64",
      cell: (c) => (
        <span className="line-clamp-2 text-zinc-700 dark:text-zinc-300" title={c.reason}>
          {c.reason}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      hideOnMobile: true,
      cell: (c) => (
        <div className="space-y-1">
          <StatusPill status={c.status} />
          {c.comment && <p className="max-w-56 text-xs text-zinc-500 dark:text-zinc-400">“{c.comment}”</p>}
        </div>
      ),
    },
  ];
  return (
    <DataList
      rows={items}
      rowKey={(c) => c.id}
      columns={columns}
      title={(c) =>
        showEmployee && c.employee ? (
          <PersonCell name={c.employee.name} meta={`${c.employee.code} · ${c.employee.department}`} />
        ) : (
          <p className="font-medium">{`${weekdayShort(c.date)}, ${fmtDate(c.date)}`}</p>
        )
      }
      aside={(c) => <StatusPill status={c.status} />}
      actions={actions}
    />
  );
}

// ---------------------------------------------------------------- HR / Admin

const BOARD_CHIPS = ["present", "late", "half_day", "missing_checkout", "absent", "on_leave", "not_checked_in"] as const;

function DailyBoard() {
  const [date, setDate] = useState(companyToday());
  const [department, setDepartment] = useState("");
  const [only, setOnly] = useState<string | null>(null);
  const depts = useApi<{ items: { id: string; name: string }[] }>("/api/org/departments");
  const board = useApi<Board>(`/api/attendance/board${qs({ date, department })}`);
  const today = companyToday();

  const rows = useMemo(() => (board.data?.rows ?? []).filter((r) => !only || r.status === only), [board.data, only]);
  const summary = board.data?.summary ?? {};
  const presentTotal = (summary.present ?? 0) + (summary.late ?? 0) + (summary.half_day ?? 0) + (summary.missing_checkout ?? 0);

  const columns: Column<BoardRow>[] = [
    { key: "emp", header: "Employee", hideOnMobile: true, cell: (r) => <PersonCell name={r.name} meta={r.code} /> },
    { key: "dept", header: "Department", cell: (r) => r.department },
    {
      key: "in",
      header: "Check-in",
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          {fmtTime(r.checkIn)}
          {r.source === "camera" && (
            <span title={`Camera check-in${r.distanceMeters != null ? `, ${r.distanceMeters} m from the office` : ""}`} className="text-teal-600 dark:text-teal-400">
              <OpsIcon name="camera" className="h-3.5 w-3.5" />
              <span className="sr-only">camera check-in</span>
            </span>
          )}
        </span>
      ),
    },
    { key: "out", header: "Check-out", cell: (r) => <span className="tabular-nums">{fmtTime(r.checkOut)}</span> },
    {
      key: "worked",
      header: "Worked",
      cell: (r) => <span className="tabular-nums">{fmtDuration(r.checkOut || date === today ? minutesBetween(r.checkIn, r.checkOut) : null)}</span>,
    },
    { key: "status", header: "Status", hideOnMobile: true, cell: (r) => <StatusPill status={r.status} /> },
  ];

  return (
    <Panel
      icon="users"
      title="Daily attendance board"
      subtitle={`${weekdayShort(date)}, ${fmtDate(date)}${board.data ? ` · ${presentTotal} of ${board.data.rows.length} in` : ""}`}
      actions={
        <>
          <Input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-10 sm:w-44" aria-label="Board date" />
          <Select value={department} onChange={(e) => setDepartment(e.target.value)} className="h-10 sm:w-48" aria-label="Department">
            <option value="">All departments</option>
            {depts.data?.items.map((d) => (
              <option key={d.id} value={d.name}>
                {d.name}
              </option>
            ))}
          </Select>
        </>
      }
      flush
    >
      {board.loading && !board.data ? (
        <ListSkeleton rows={5} />
      ) : board.error ? (
        <div className="p-5">
          <ErrorState message={board.error} onRetry={board.reload} />
        </div>
      ) : board.data ? (
        <>
          <div className="space-y-3 border-b border-zinc-100 px-4 py-4 sm:px-5 dark:border-zinc-800/70">
            {!board.data.isWorkingDay && (
              <Banner tone="info" icon="info" title={board.data.holiday ? `Public holiday: ${board.data.holiday}` : "Not a working day"}>
                Only people who checked in anyway are listed.
              </Banner>
            )}
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
              {BOARD_CHIPS.map((k) => {
                const n = summary[k === "not_checked_in" ? "notCheckedIn" : k] ?? 0;
                const active = only === k;
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setOnly(active ? null : k)}
                    className={cx(
                      "inline-flex h-9 items-center gap-2 rounded-full px-3 text-[13px] ring-1 ring-inset transition-colors",
                      active
                        ? "bg-zinc-900 text-white ring-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:ring-zinc-100"
                        : "bg-white text-zinc-700 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-700 dark:hover:bg-zinc-800",
                    )}
                  >
                    <span className={cx("h-2 w-2 rounded-full", DOT[toneOf(k)])} aria-hidden />
                    {humanize(k)}
                    <span className="font-semibold tabular-nums">{n}</span>
                  </button>
                );
              })}
            </div>
          </div>
          {rows.length ? (
            <DataList rows={rows} rowKey={(r) => r.employeeId} columns={columns} title={(r) => <PersonCell name={r.name} meta={r.code} />} aside={(r) => <StatusPill status={r.status} />} />
          ) : (
            <EmptyBlock
              icon="users"
              title={only ? `Nobody is “${humanize(only).toLowerCase()}” on this day` : "No attendance for this day"}
              hint={only ? "Clear the filter to see everyone." : "Records appear here as people check in."}
              action={
                only ? (
                  <Button size="sm" variant="secondary" onClick={() => setOnly(null)}>
                    Clear filter
                  </Button>
                ) : undefined
              }
            />
          )}
        </>
      ) : null}
    </Panel>
  );
}

type CorrectionTab = "PENDING" | "APPROVED" | "REJECTED" | "ALL";

function CorrectionsInbox({ canDecide, myEmployeeId }: { canDecide: boolean; myEmployeeId: string | null }) {
  const list = useApi<{ items: Correction[] }>("/api/attendance/corrections");
  const [tab, setTab] = useState<CorrectionTab>("PENDING");
  const [review, setReview] = useState<Correction | null>(null);

  const items = list.data?.items ?? [];
  const count = (s: string) => items.filter((c) => c.status === s).length;
  const shown = tab === "ALL" ? items : items.filter((c) => c.status === tab);

  return (
    <Panel
      icon="edit"
      title="Correction requests"
      subtitle={canDecide ? "Approving replaces the day's attendance with the requested times." : "Only HR can approve or reject requests."}
      actions={!canDecide ? <Badge>View only</Badge> : undefined}
      flush
    >
      <div className="border-b border-zinc-100 px-4 py-3 sm:px-5 dark:border-zinc-800/70">
        <SegmentedTabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "PENDING", label: "Pending", count: count("PENDING") },
            { id: "APPROVED", label: "Approved", count: count("APPROVED") },
            { id: "REJECTED", label: "Rejected", count: count("REJECTED") },
            { id: "ALL", label: "All", count: items.length },
          ]}
        />
      </div>
      {list.loading && !list.data ? (
        <ListSkeleton rows={3} />
      ) : list.error ? (
        <div className="p-5">
          <ErrorState message={list.error} onRetry={list.reload} />
        </div>
      ) : shown.length ? (
        <CorrectionList
          items={shown}
          showEmployee
          actions={
            canDecide
              ? (c) =>
                  c.status !== "PENDING" ? null : c.employeeId === myEmployeeId ? (
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">Your own request</span>
                  ) : (
                    <Button size="sm" variant="secondary" className="h-9 px-3" onClick={() => setReview(c)}>
                      Review
                    </Button>
                  )
              : undefined
          }
        />
      ) : (
        <EmptyBlock icon="inbox" title={tab === "PENDING" ? "All caught up" : "Nothing here"} hint={tab === "PENDING" ? "No correction requests are waiting." : undefined} />
      )}

      <Modal open={!!review} title="Review correction request" onClose={() => setReview(null)}>
        {review && (
          <DecisionForm
            key={review.id}
            item={review}
            onClose={() => setReview(null)}
            onDone={() => {
              setReview(null);
              list.reload();
            }}
          />
        )}
      </Modal>
    </Panel>
  );
}

function DecisionForm({ item, onClose, onDone }: { item: Correction; onClose: () => void; onDone: () => void }) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(approve: boolean) {
    setBusy(approve ? "approve" : "reject");
    setError(null);
    try {
      await api(`/api/attendance/corrections/${item.id}/decision`, { body: { approve, comment: comment || undefined } });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {item.employee && <PersonCell name={item.employee.name} meta={`${item.employee.code} · ${item.employee.department}`} />}
      <dl className="grid grid-cols-3 gap-3 rounded-xl bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
        <div>
          <dt className="text-[11px] uppercase tracking-[0.06em] text-zinc-500 dark:text-zinc-400">Day</dt>
          <dd className="mt-0.5 font-medium">{fmtDate(item.date)}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-[0.06em] text-zinc-500 dark:text-zinc-400">In</dt>
          <dd className="mt-0.5 font-medium tabular-nums">{fmtTime(item.checkIn)}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-[0.06em] text-zinc-500 dark:text-zinc-400">Out</dt>
          <dd className="mt-0.5 font-medium tabular-nums">{fmtTime(item.checkOut)}</dd>
        </div>
      </dl>
      <div>
        <p className="text-[11px] uppercase tracking-[0.06em] text-zinc-500 dark:text-zinc-400">Reason</p>
        <p className="mt-1 text-sm">{item.reason}</p>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <Field label="Comment" hint="Required when rejecting; shown to the employee.">
        <Textarea rows={3} maxLength={300} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button type="button" variant="danger" loading={busy === "reject"} disabled={!!busy || !comment.trim()} onClick={() => decide(false)}>
          <OpsIcon name="x" /> Reject
        </Button>
        <Button type="button" loading={busy === "approve"} disabled={!!busy} onClick={() => decide(true)}>
          <OpsIcon name="check" /> Approve
        </Button>
      </div>
    </div>
  );
}
