"use client";

import { useState } from "react";
import { SmartLeaveForm } from "@/components/ai/SmartLeaveForm";
import { useMe } from "@/components/shell/AppShell";
import { Button, Card, EmptyState, ErrorState, Input, Loading, Notice, PageHeader, Select, Stat, StatusBadge, Table, Td } from "@/components/ui";
import { api, fmtDate, qs, useApi } from "@/lib/client";

interface LeaveRow {
  id: string;
  employeeId: string;
  employee: { name: string; code: string; department: string };
  type: string;
  typeName: string;
  start: string;
  end: string;
  days: number;
  reason: string;
  status: string;
  comment: string | null;
  canCancel: boolean;
}
interface Balance {
  year: number;
  balances: { type: string; name: string; quota: number | null; usedApproved: number; pending: number; remaining: number | null }[];
}

export default function LeavePage() {
  const me = useMe();
  return (
    <div className="space-y-6">
      <PageHeader title="Leave" subtitle={me.role === "EMPLOYEE" ? "Apply in plain words, track your balance and requests." : "Leave requests and approvals."} />
      {me.employeeId && <MyLeave />}
      {(me.role === "HR" || me.role === "ADMIN") && <AllRequests canDecide={me.role === "HR"} />}
    </div>
  );
}

function MyLeave() {
  const balance = useApi<Balance>("/api/leave-balance");
  const mine = useApi<{ items: LeaveRow[] }>("/api/leave-requests?mine=1");
  const [error, setError] = useState<string | null>(null);

  async function cancel(id: string) {
    setError(null);
    try {
      await api(`/api/leave-requests/${id}/cancel`, { method: "POST", body: {} });
      mine.reload();
      balance.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <SmartLeaveForm
        leaveTypes={balance.data?.balances.map((b) => ({ code: b.type, name: b.name })) ?? []}
        leaveTypesLoading={balance.loading && !balance.data}
        onSubmit={async (v) => {
          try {
            await api("/api/leave-requests", { body: v });
            mine.reload();
            balance.reload();
            return { ok: true, message: "Leave request sent to HR for approval." };
          } catch (e) {
            return { ok: false, message: (e as Error).message };
          }
        }}
      />

      {balance.error ? (
        <ErrorState message={balance.error} onRetry={balance.reload} />
      ) : balance.loading && !balance.data ? (
        <Loading />
      ) : balance.data?.balances.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {balance.data.balances.map((b) => (
            <Stat key={b.type} label={`${b.name} left`} value={b.remaining ?? "∞"} hint={b.quota != null ? `${b.usedApproved} used of ${b.quota}${b.pending ? ` · ${b.pending} pending` : ""}` : "unlimited"} />
          ))}
        </div>
      ) : (
        <EmptyState title="No leave types configured" hint="Ask an Admin to add leave types in Company setup." />
      )}

      <Card title="My requests">
        {error && <Notice tone="error">{error}</Notice>}
        {mine.loading && !mine.data ? (
          <Loading />
        ) : mine.error ? (
          <ErrorState message={mine.error} onRetry={mine.reload} />
        ) : mine.data?.items.length ? (
          <Table head={["Type", "From", "To", "Days", "Reason", "Status", ""]}>
            {mine.data.items.map((l) => (
              <tr key={l.id}>
                <Td>{l.typeName}</Td>
                <Td>{fmtDate(l.start)}</Td>
                <Td>{fmtDate(l.end)}</Td>
                <Td>{l.days}</Td>
                <Td className="max-w-48 truncate">{l.reason}</Td>
                <Td>
                  <StatusBadge status={l.status} />
                  {l.comment && <p className="text-xs text-zinc-500">{l.comment}</p>}
                </Td>
                <Td>
                  {l.canCancel && (
                    <Button size="sm" variant="secondary" onClick={() => cancel(l.id)}>
                      Cancel
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        ) : (
          <EmptyState title="No leave requests yet" hint="Describe your leave above to fill the form." />
        )}
      </Card>
    </>
  );
}

function AllRequests({ canDecide }: { canDecide: boolean }) {
  const [status, setStatus] = useState("PENDING");
  const list = useApi<{ items: LeaveRow[] }>(`/api/leave-requests${qs({ status })}`);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function decide(id: string, decision: "APPROVED" | "REJECTED") {
    setBusy(id);
    setError(null);
    try {
      await api(`/api/leave-requests/${id}/decision`, { body: { decision, comment: comments[id] || undefined } });
      list.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card
      title={canDecide ? "Approval inbox" : "All leave requests (view only)"}
      actions={
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="CANCELLED">Cancelled</option>
          <option value="">All</option>
        </Select>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      {list.loading && !list.data ? (
        <Loading />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : list.data?.items.length ? (
        <Table head={["Employee", "Type", "From", "To", "Days", "Reason", "Status", ...(canDecide ? [""] : [])]}>
          {list.data.items.map((l) => (
            <tr key={l.id}>
              <Td>
                {l.employee.name} <span className="text-xs text-zinc-500">{l.employee.department}</span>
              </Td>
              <Td>{l.typeName}</Td>
              <Td>{fmtDate(l.start)}</Td>
              <Td>{fmtDate(l.end)}</Td>
              <Td>{l.days}</Td>
              <Td className="max-w-48 truncate">{l.reason}</Td>
              <Td>
                <StatusBadge status={l.status} />
                {l.comment && <p className="text-xs text-zinc-500">{l.comment}</p>}
              </Td>
              {canDecide && (
                <Td>
                  {l.status === "PENDING" && (
                    <div className="flex min-w-56 flex-col gap-1">
                      <Input placeholder="Comment (needed to reject)" value={comments[l.id] ?? ""} onChange={(e) => setComments((m) => ({ ...m, [l.id]: e.target.value }))} />
                      <div className="flex gap-1">
                        <Button size="sm" loading={busy === l.id} onClick={() => decide(l.id, "APPROVED")}>
                          Approve
                        </Button>
                        <Button size="sm" variant="danger" disabled={busy === l.id} onClick={() => decide(l.id, "REJECTED")}>
                          Reject
                        </Button>
                      </div>
                    </div>
                  )}
                </Td>
              )}
            </tr>
          ))}
        </Table>
      ) : (
        <EmptyState title={status === "PENDING" ? "Nothing waiting for approval" : "No requests"} />
      )}
    </Card>
  );
}
