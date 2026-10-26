"use client";

import { useState } from "react";
import { useMe } from "@/components/shell/AppShell";
import { Button, Card, EmptyState, ErrorState, Field, Input, Loading, Modal, Notice, PageHeader, StatusBadge, Table, Td } from "@/components/ui";
import { api, fmtDateTime, fmtMonth, money, useApi } from "@/lib/client";

interface Run {
  id: string;
  month: string;
  status: "DRAFT" | "FINALIZED";
  finalizedAt: string | null;
  totals: { employees: number; gross: number; deductions: number; tax: number; net: number };
  payslips: {
    id: string;
    code: string;
    name: string;
    department: string;
    gross: number;
    deductions: number;
    tax: number;
    net: number;
    workingDays: number;
    paidDays: number;
    lateDays: number;
    latePenaltyDays: number;
  }[];
}
interface RunListItem {
  id: string;
  month: string;
  status: string;
  employees: number;
  totalGross: number;
  totalNet: number;
}

const thisMonth = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" }).slice(0, 7);

// M6: HR prepares the monthly draft; only Admin can finalize (lock) it.
export default function PayrollPage() {
  const me = useMe();
  const [month, setMonth] = useState(thisMonth());
  const runs = useApi<{ items: RunListItem[] }>("/api/payroll/runs");
  // Only ask for a month that has a run; the list already says which ones do (no 404 per empty month).
  const listed = !!runs.data?.items.some((r) => r.month === month);
  const runApi = useApi<Run>(month && listed ? `/api/payroll/runs/${month}` : null);
  // Never show another month's run while the selected one loads.
  const run = { ...runApi, data: runApi.data?.month === month ? runApi.data : null };
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const noRun = (!!runs.data && !listed) || !!run.error?.startsWith("No payroll run");
  const runLoading = (runs.loading && !runs.data) || (listed && !run.data && !run.error);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      setMessage({ tone: "success", text: ok });
      run.reload();
      runs.reload();
    } catch (e) {
      setMessage({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  const finalized = run.data?.status === "FINALIZED";

  return (
    <div className="space-y-6">
      <PageHeader title="Payroll" subtitle="Gross = 1.5 × basic. Deductions for absence, unpaid leave and half days. HR prepares the draft; Admin finalizes." />

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Month" className="w-44">
            <Input type="month" value={month} max={thisMonth()} onChange={(e) => setMonth(e.target.value)} />
          </Field>
          {me.role === "HR" && (
            <Button loading={busy} disabled={finalized || !month} onClick={() => act(() => api("/api/payroll/runs", { body: { month } }), `Draft for ${fmtMonth(month)} is ready.`)}>
              {run.data ? "Recompute draft" : "Create draft"}
            </Button>
          )}
          {me.role === "ADMIN" && run.data && !finalized && (
            <Button variant="danger" disabled={busy} onClick={() => setConfirmOpen(true)}>
              Finalize (locks the month)
            </Button>
          )}
          {run.data && <StatusBadge status={run.data.status} />}
          {finalized && run.data?.finalizedAt && <span className="text-xs text-zinc-500">Locked on {fmtDateTime(run.data.finalizedAt)}</span>}
        </div>
        {message && (
          <div className="mt-3">
            <Notice tone={message.tone}>{message.text}</Notice>
          </div>
        )}
      </Card>

      <Card title={`Payslips · ${fmtMonth(month)}`}>
        {runLoading ? (
          <Loading />
        ) : noRun ? (
          <EmptyState title={`No payroll for ${fmtMonth(month)} yet`} hint={me.role === "HR" ? "Create the draft to calculate everyone's pay." : "HR has not prepared this month yet."} />
        ) : run.error || runs.error ? (
          <ErrorState message={run.error ?? runs.error ?? ""} onRetry={() => (run.error ? run.reload() : runs.reload())} />
        ) : run.data && run.data.payslips.length === 0 ? (
          <EmptyState title="No employees in this month" />
        ) : (
          run.data && (
            <>
              {/* Phones: one card per payslip instead of an eight-column table */}
              <ul className="-mx-1 space-y-2 sm:hidden">
                {run.data.payslips.map((p) => (
                  <li key={p.id} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-medium">{p.name}</span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">{money(p.net)}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {p.code} · {p.department} · {p.paidDays} / {p.workingDays} days paid
                    </p>
                    {p.latePenaltyDays > 0 && <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-300">incl. {p.latePenaltyDays} day late penalty ({p.lateDays} late days)</p>}
                    <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                      <div>
                        <dt className="text-zinc-500">Gross</dt>
                        <dd className="tabular-nums">{money(p.gross)}</dd>
                      </div>
                      <div>
                        <dt className="text-zinc-500">Deductions</dt>
                        <dd className="tabular-nums">{money(p.deductions)}</dd>
                      </div>
                      <div>
                        <dt className="text-zinc-500">Tax</dt>
                        <dd className="tabular-nums">{money(p.tax)}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
                <li className="flex items-baseline justify-between rounded-xl bg-zinc-50 p-3 text-sm font-semibold dark:bg-zinc-900">
                  <span>Total · {run.data.totals.employees} employees</span>
                  <span className="tabular-nums">{money(run.data.totals.net)} net</span>
                </li>
              </ul>
              <div className="hidden sm:block">
                <Table head={["Code", "Employee", "Department", "Days paid", "Gross", "Deductions", "Tax", "Net"]}>
                  {run.data.payslips.map((p) => (
                    <tr key={p.id}>
                      <Td>{p.code}</Td>
                      <Td>{p.name}</Td>
                      <Td>{p.department}</Td>
                      <Td>
                        {p.paidDays} / {p.workingDays}
                        {p.latePenaltyDays > 0 && (
                          <span className="block text-[11px] text-amber-700 dark:text-amber-300" title={`${p.lateDays} late days`}>
                            incl. {p.latePenaltyDays} day late penalty
                          </span>
                        )}
                      </Td>
                      <Td className="tabular-nums">{money(p.gross)}</Td>
                      <Td className="tabular-nums">{money(p.deductions)}</Td>
                      <Td className="tabular-nums">{money(p.tax)}</Td>
                      <Td className="tabular-nums font-medium">{money(p.net)}</Td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <Td>Total</Td>
                    <Td>{run.data.totals.employees} employees</Td>
                    <Td />
                    <Td />
                    <Td className="tabular-nums">{money(run.data.totals.gross)}</Td>
                    <Td className="tabular-nums">{money(run.data.totals.deductions)}</Td>
                    <Td className="tabular-nums">{money(run.data.totals.tax)}</Td>
                    <Td className="tabular-nums">{money(run.data.totals.net)}</Td>
                  </tr>
                </Table>
              </div>
            </>
          )
        )}
      </Card>

      <Card title="All runs">
        {runs.loading ? (
          <Loading />
        ) : runs.error ? (
          <ErrorState message={runs.error} onRetry={runs.reload} />
        ) : !runs.data?.items.length ? (
          <EmptyState title="No payroll runs yet" />
        ) : (
          <>
            <ul className="-mx-1 space-y-2 sm:hidden">
              {runs.data.items.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setMonth(r.month)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-zinc-200 p-3 text-left hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{fmtMonth(r.month)}</span>
                      <span className="block text-xs text-zinc-500">
                        {r.employees} employees · net {money(r.totalNet)}
                      </span>
                    </span>
                    <StatusBadge status={r.status} />
                  </button>
                </li>
              ))}
            </ul>
            <div className="hidden sm:block">
              <Table head={["Month", "Status", "Employees", "Gross", "Net", ""]}>
                {runs.data.items.map((r) => (
                  <tr key={r.id}>
                    <Td>{fmtMonth(r.month)}</Td>
                    <Td>
                      <StatusBadge status={r.status} />
                    </Td>
                    <Td>{r.employees}</Td>
                    <Td className="tabular-nums">{money(r.totalGross)}</Td>
                    <Td className="tabular-nums">{money(r.totalNet)}</Td>
                    <Td>
                      <Button size="sm" variant="secondary" onClick={() => setMonth(r.month)}>
                        View
                      </Button>
                    </Td>
                  </tr>
                ))}
              </Table>
            </div>
          </>
        )}
      </Card>

      <Modal
        open={confirmOpen}
        title={`Finalize payroll for ${fmtMonth(month)}?`}
        onClose={() => setConfirmOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy} onClick={() => act(() => api(`/api/payroll/runs/${month}/finalize`, { method: "POST" }), `Payroll for ${fmtMonth(month)} is finalized and locked.`)}>
              Finalize
            </Button>
          </>
        }
      >
        <p className="text-sm">
          This locks {fmtMonth(month)}: payslips can no longer be recomputed or changed, and every employee is notified that their payslip is ready.
        </p>
      </Modal>
    </div>
  );
}
