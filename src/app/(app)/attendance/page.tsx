"use client";

import { useState } from "react";
import { CheckInWidget } from "@/components/attendance/CheckInWidget";
import { useMe } from "@/components/shell/AppShell";
import { Button, Card, EmptyState, ErrorState, Field, Input, Loading, Notice, PageHeader, StatusBadge, Table, Td } from "@/components/ui";
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
}

const todayLocal = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10); // Asia/Karachi

export default function AttendancePage() {
  const me = useMe();
  const isStaff = me.role === "ADMIN" || me.role === "HR";
  return (
    <div className="space-y-6">
      <PageHeader title="Attendance" subtitle="Check in and out, see your month, and request corrections." />
      {me.employeeId && <MyAttendance />}
      {isStaff && <DailyBoard />}
      {isStaff && <CorrectionsInbox canDecide={me.role === "HR"} />}
    </div>
  );
}

function MyAttendance() {
  const [month, setMonth] = useState(todayLocal().slice(0, 7));
  const cal = useApi<Calendar>(`/api/attendance/calendar${qs({ month })}`);
  const mine = useApi<{ items: Correction[] }>("/api/attendance/corrections");

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <CheckInWidget onChange={cal.reload} />
        <CorrectionForm onDone={mine.reload} />
      </div>

      <Card
        title={`My month${cal.data?.attendanceRatePct != null ? ` · attendance ${cal.data.attendanceRatePct}%` : ""}`}
        actions={<Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" />}
      >
        {cal.loading && !cal.data ? (
          <Loading />
        ) : cal.error ? (
          <ErrorState message={cal.error} onRetry={cal.reload} />
        ) : (
          <Table head={["Date", "Status", "In", "Out"]}>
            {cal.data?.days
              .filter((d) => d.kind !== "future")
              .map((d) => (
                <tr key={d.date}>
                  <Td>{fmtDate(d.date)}</Td>
                  <Td>
                    <StatusBadge status={d.holiday ? "holiday" : d.kind} /> {d.holiday && <span className="text-xs text-zinc-500">{d.holiday}</span>}
                  </Td>
                  <Td>{fmtTime(d.checkIn)}</Td>
                  <Td>{fmtTime(d.checkOut)}</Td>
                </tr>
              ))}
          </Table>
        )}
      </Card>

      <Card title="My correction requests">
        {mine.data?.items.length ? <CorrectionTable items={mine.data.items} /> : <EmptyState title="No correction requests" />}
      </Card>
    </>
  );
}

function CorrectionForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ date: "", checkIn: "09:00", checkOut: "", reason: "" });
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/attendance/corrections", { body: { ...form, checkOut: form.checkOut || null } });
      setMsg({ tone: "success", text: "Sent to HR for approval." });
      setForm({ date: "", checkIn: "09:00", checkOut: "", reason: "" });
      onDone();
    } catch (err) {
      setMsg({ tone: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Request a correction">
      <form onSubmit={submit} className="space-y-3">
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <div className="grid grid-cols-3 gap-2">
          <Field label="Date">
            <Input type="date" required max={todayLocal()} value={form.date} onChange={set("date")} />
          </Field>
          <Field label="Check-in">
            <Input type="time" required value={form.checkIn} onChange={set("checkIn")} />
          </Field>
          <Field label="Check-out">
            <Input type="time" value={form.checkOut} onChange={set("checkOut")} />
          </Field>
        </div>
        <Field label="Reason">
          <Input required minLength={3} maxLength={300} value={form.reason} onChange={set("reason")} />
        </Field>
        <Button type="submit" loading={busy}>
          Send request
        </Button>
      </form>
    </Card>
  );
}

function CorrectionTable({ items, actions }: { items: Correction[]; actions?: (c: Correction) => React.ReactNode }) {
  return (
    <Table head={["Employee", "Date", "In", "Out", "Reason", "Status", ...(actions ? [""] : [])]}>
      {items.map((c) => (
        <tr key={c.id}>
          <Td>{c.employee ? `${c.employee.name} (${c.employee.code})` : "Me"}</Td>
          <Td>{fmtDate(c.date)}</Td>
          <Td>{fmtTime(c.checkIn)}</Td>
          <Td>{fmtTime(c.checkOut)}</Td>
          <Td className="max-w-48 truncate">{c.reason}</Td>
          <Td>
            <StatusBadge status={c.status} />
            {c.comment && <p className="text-xs text-zinc-500">{c.comment}</p>}
          </Td>
          {actions && <Td>{actions(c)}</Td>}
        </tr>
      ))}
    </Table>
  );
}

function DailyBoard() {
  const [date, setDate] = useState(todayLocal());
  const board = useApi<{ isWorkingDay: boolean; holiday: string | null; summary: Record<string, number>; rows: BoardRow[] }>(
    `/api/attendance/board${qs({ date })}`,
  );
  return (
    <Card title="Daily attendance board" actions={<Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />}>
      {board.loading && !board.data ? (
        <Loading />
      ) : board.error ? (
        <ErrorState message={board.error} onRetry={board.reload} />
      ) : board.data ? (
        <div className="space-y-3">
          {!board.data.isWorkingDay && <Notice>{board.data.holiday ? `Holiday: ${board.data.holiday}` : "Not a working day."}</Notice>}
          <p className="text-xs text-zinc-500">
            Present {board.data.summary.present} · Late {board.data.summary.late} · Half day {board.data.summary.half_day} · Absent {board.data.summary.absent} · On leave{" "}
            {board.data.summary.on_leave} · Not checked in {board.data.summary.notCheckedIn}
          </p>
          {board.data.rows.length ? (
            <Table head={["Employee", "Department", "Status", "In", "Out"]}>
              {board.data.rows.map((r) => (
                <tr key={r.employeeId}>
                  <Td>
                    {r.name} <span className="text-xs text-zinc-500">{r.code}</span>
                  </Td>
                  <Td>{r.department}</Td>
                  <Td>
                    <StatusBadge status={r.status} />
                  </Td>
                  <Td>{fmtTime(r.checkIn)}</Td>
                  <Td>{fmtTime(r.checkOut)}</Td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState title="No attendance for this day" />
          )}
        </div>
      ) : null}
    </Card>
  );
}

function CorrectionsInbox({ canDecide }: { canDecide: boolean }) {
  const list = useApi<{ items: Correction[] }>("/api/attendance/corrections");
  const [comments, setComments] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(id: string, approve: boolean) {
    setBusy(id);
    setError(null);
    try {
      await api(`/api/attendance/corrections/${id}/decision`, { body: { approve, comment: comments[id] || undefined } });
      list.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card title={canDecide ? "Correction requests" : "Correction requests (view only)"}>
      {error && <Notice tone="error">{error}</Notice>}
      {list.loading && !list.data ? (
        <Loading />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : list.data?.items.length ? (
        <CorrectionTable
          items={list.data.items}
          actions={
            canDecide
              ? (c) =>
                  c.status === "PENDING" ? (
                    <div className="flex min-w-56 flex-col gap-1">
                      <Input placeholder="Comment (needed to reject)" value={comments[c.id] ?? ""} onChange={(e) => setComments((m) => ({ ...m, [c.id]: e.target.value }))} />
                      <div className="flex gap-1">
                        <Button size="sm" loading={busy === c.id} onClick={() => decide(c.id, true)}>
                          Approve
                        </Button>
                        <Button size="sm" variant="danger" disabled={busy === c.id} onClick={() => decide(c.id, false)}>
                          Reject
                        </Button>
                      </div>
                    </div>
                  ) : null
              : undefined
          }
        />
      ) : (
        <EmptyState title="No correction requests" />
      )}
    </Card>
  );
}
