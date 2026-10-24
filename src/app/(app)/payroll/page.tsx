"use client";

import { useState } from "react";
import { useMe } from "@/components/shell/AppShell";
import { Button, Card, EmptyState, ErrorState, Field, Input, Loading, Modal, Notice, PageHeader, StatusBadge, Table, Td } from "@/components/ui";
import { api, fmtDateTime, money, useApi } from "@/lib/client";

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
  const run = useApi<Run>(month ? `/api/payroll/runs/${month}` : null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const noRun = run.error?.startsWith("No payroll run");

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
            <Button loading={busy} disabled={finalized || !month} onClick={() => act(() => api("/api/payroll/runs", { body: { month } }), `Draft for ${month} is ready.`)}>
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

      <Card title={`Payslips · ${month}`}>
        {run.loading ? (
          <Loading />
        ) : noRun ? (
          <EmptyState title={`No payroll for ${month} yet`} hint={me.role === "HR" ? "Create the draft to calculate everyone's pay." : "HR has not prepared this month yet."} />
        ) : run.error ? (
          <ErrorState message={run.error} onRetry={run.reload} />
        ) : run.data && run.data.payslips.length === 0 ? (
          <EmptyState title="No employees in this month" />
        ) : (
          run.data && (
            <Table head={["Code", "Employee", "Department", "Days paid", "Gross", "Deductions", "Tax", "Net"]}>
              {run.data.payslips.map((p) => (
                <tr key={p.id}>
                  <Td>{p.code}</Td>
                  <Td>{p.name}</Td>
                  <Td>{p.department}</Td>
                  <Td>
                    {p.paidDays} / {p.workingDays}
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
          <Table head={["Month", "Status", "Employees", "Gross", "Net", ""]}>
            {runs.data.items.map((r) => (
              <tr key={r.id}>
                <Td>{r.month}</Td>
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
        )}
      </Card>

      <Modal
        open={confirmOpen}
        title={`Finalize payroll for ${month}?`}
        onClose={() => setConfirmOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy} onClick={() => act(() => api(`/api/payroll/runs/${month}/finalize`, { method: "POST" }), `Payroll for ${month} is finalized and locked.`)}>
              Finalize
            </Button>
          </>
        }
      >
        <p className="text-sm">
          This locks {month}: payslips can no longer be recomputed or changed, and every employee is notified that their payslip is ready.
        </p>
      </Modal>
    </div>
  );
}
