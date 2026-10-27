"use client";

import { useState } from "react";
import { SmartLeaveForm } from "@/components/ai/SmartLeaveForm";
import { companyToday, fmtRange } from "@/components/ops/format";
import { OpsIcon } from "@/components/ops/icons";
import { DataList, EmptyBlock, ListSkeleton, Panel, PersonCell, ProgressBar, SegmentedTabs, Skeleton, StatusPill, type Column } from "@/components/ops/primitives";
import { useMe } from "@/components/shell/AppShell";
import { Badge, Button, ErrorState, Field, Modal, Notice, PageHeader, Textarea } from "@/components/ui";
import { api, useApi } from "@/lib/client";

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

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export default function LeavePage() {
  const me = useMe();
  const staff = me.role === "HR" || me.role === "ADMIN";
  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave"
        subtitle={
          me.role === "EMPLOYEE"
            ? "Apply in plain words, track your balance and requests."
            : me.role === "HR"
              ? "Approve or reject requests, and see who is away."
              : "Every leave request in the company (HR decides them)."
        }
      />
      {staff && <AllRequests canDecide={me.role === "HR"} myEmployeeId={me.employeeId} />}
      {me.employeeId && <MyLeave showHeading={staff} />}
    </div>
  );
}

// ---------- Employee self-service ----------

function MyLeave({ showHeading }: { showHeading: boolean }) {
  const balance = useApi<Balance>("/api/leave-balance");
  const mine = useApi<{ items: LeaveRow[] }>("/api/leave-requests?mine=1");
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  async function cancel(id: string) {
    setError(null);
    setCancelling(id);
    try {
      await api(`/api/leave-requests/${id}/cancel`, { method: "POST", body: {} });
      mine.reload();
      balance.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCancelling(null);
    }
  }

  const columns: Column<LeaveRow>[] = [
    { key: "type", header: "Type", cell: (l) => <span className="font-medium">{l.typeName}</span>, hideOnMobile: true },
    { key: "dates", header: "Dates", cell: (l) => fmtRange(l.start, l.end) },
    { key: "days", header: "Days", cell: (l) => l.days, align: "right" },
    { key: "reason", header: "Reason", cell: (l) => <span className="line-clamp-2 max-w-64 text-zinc-600 dark:text-zinc-400">{l.reason}</span> },
    {
      key: "status",
      header: "Status",
      hideOnMobile: true,
      cell: (l) => (
        <div className="space-y-1">
          <StatusPill status={l.status} />
          {l.comment && <p className="max-w-48 text-xs text-zinc-500 dark:text-zinc-400">“{l.comment}”</p>}
        </div>
      ),
    },
  ];

  return (
    <>
      {showHeading && <h2 className="pt-2 text-lg font-semibold tracking-tight">My leave</h2>}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
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
        </div>
        <BalancePanel balance={balance} />
      </div>

      <Panel icon="file" title="My requests" subtitle="Pending leave, and approved leave that has not started, can be cancelled." flush>
        {error && (
          <div className="px-4 pt-4 sm:px-5">
            <Notice tone="error">{error}</Notice>
          </div>
        )}
        {mine.loading && !mine.data ? (
          <ListSkeleton rows={3} />
        ) : mine.error ? (
          <div className="p-5">
            <ErrorState message={mine.error} onRetry={mine.reload} />
          </div>
        ) : mine.data?.items.length ? (
          <DataList
            rows={mine.data.items}
            rowKey={(l) => l.id}
            columns={columns}
            title={(l) => (
              <div>
                <p className="font-medium">{l.typeName} leave</p>
                {l.comment && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">HR: “{l.comment}”</p>}
              </div>
            )}
            aside={(l) => <StatusPill status={l.status} />}
            actions={(l) =>
              l.canCancel ? (
                <Button size="sm" variant="secondary" className="h-9 px-3" loading={cancelling === l.id} disabled={!!cancelling} onClick={() => cancel(l.id)}>
                  Cancel
                </Button>
              ) : null
            }
          />
        ) : (
          <EmptyBlock icon="calendar" title="No leave requests yet" hint="Describe your leave above and the form fills itself in." />
        )}
      </Panel>
    </>
  );
}

function BalancePanel({ balance }: { balance: ReturnType<typeof useApi<Balance>> }) {
  return (
    <Panel title={`Balance ${balance.data?.year ?? ""}`.trim()} subtitle="Working days left this year">
      {balance.error ? (
        <ErrorState message={balance.error} onRetry={balance.reload} />
      ) : balance.loading && !balance.data ? (
        <div className="space-y-5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-2 w-full" />
            </div>
          ))}
        </div>
      ) : balance.data?.balances.length ? (
        <ul className="space-y-5">
          {balance.data.balances.map((b) => (
            <li key={b.type} className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{b.name}</span>
                <span className="text-sm tabular-nums text-zinc-500 dark:text-zinc-400">
                  {b.quota == null ? (
                    "No yearly limit"
                  ) : (
                    <>
                      <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{b.remaining}</span> / {b.quota}
                    </>
                  )}
                </span>
              </div>
              {b.quota != null && (
                <>
                  <ProgressBar
                    label={`${b.name}: ${b.usedApproved} used, ${b.pending} pending, ${b.remaining} left of ${b.quota}`}
                    segments={[
                      { value: b.usedApproved, className: "bg-teal-500" },
                      { value: b.pending, className: "bg-amber-400" },
                      { value: Math.max(0, b.quota - b.usedApproved - b.pending), className: "" },
                    ]}
                  />
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {b.usedApproved} used{b.pending ? ` · ${b.pending} pending` : ""}
                  </p>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyBlock icon="calendar" title="No leave types configured" hint="Ask an Admin to add leave types in Company setup." />
      )}
    </Panel>
  );
}

// ---------- HR inbox / Admin view ----------

type Tab = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "ALL";

function AllRequests({ canDecide, myEmployeeId }: { canDecide: boolean; myEmployeeId: string | null }) {
  const list = useApi<{ items: LeaveRow[] }>("/api/leave-requests");
  const [tab, setTab] = useState<Tab>("PENDING");
  const [review, setReview] = useState<LeaveRow | null>(null);

  const items = list.data?.items ?? [];
  const count = (s: string) => items.filter((l) => l.status === s).length;
  const shown = tab === "ALL" ? items : items.filter((l) => l.status === tab);

  const columns: Column<LeaveRow>[] = [
    { key: "employee", header: "Employee", cell: (l) => <PersonCell name={l.employee.name} meta={`${l.employee.code} · ${l.employee.department}`} />, hideOnMobile: true },
    {
      key: "leave",
      header: "Leave",
      cell: (l) => (
        <div>
          <p className="whitespace-nowrap font-medium">{fmtRange(l.start, l.end)}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {l.typeName} · {plural(l.days, "day")}
          </p>
        </div>
      ),
    },
    { key: "reason", header: "Reason", cell: (l) => <span className="line-clamp-2 text-zinc-600 dark:text-zinc-400">{l.reason}</span> },
    {
      key: "status",
      header: "Status",
      hideOnMobile: true,
      cell: (l) => (
        <div className="space-y-1">
          <StatusPill status={l.status} />
          {l.comment && <p className="max-w-44 text-xs text-zinc-500 dark:text-zinc-400">“{l.comment}”</p>}
        </div>
      ),
    },
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Panel
        className="xl:col-span-2"
        icon="inbox"
        title={canDecide ? "Approval inbox" : "All leave requests"}
        subtitle={canDecide ? "Approving deducts the days from the employee's balance. Rejecting needs a comment." : "Only HR can approve or reject leave."}
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
              { id: "CANCELLED", label: "Cancelled", count: count("CANCELLED") },
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
          <DataList
            rows={shown}
            rowKey={(l) => l.id}
            columns={columns}
            title={(l) => <PersonCell name={l.employee.name} meta={`${l.employee.code} · ${l.employee.department}`} />}
            aside={(l) => <StatusPill status={l.status} />}
            actions={
              canDecide
                ? (l) =>
                    l.status !== "PENDING" ? null : l.employeeId === myEmployeeId ? (
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">Your own request</span>
                    ) : (
                      <Button size="sm" className="h-9 px-3" onClick={() => setReview(l)}>
                        Review
                      </Button>
                    )
                : undefined
            }
          />
        ) : (
          <EmptyBlock
            icon="inbox"
            title={tab === "PENDING" ? "All caught up" : "Nothing here"}
            hint={tab === "PENDING" ? "No leave requests are waiting for a decision." : undefined}
          />
        )}

        <Modal open={!!review} title="Review leave request" onClose={() => setReview(null)}>
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

      <AwayPanel items={items} loading={list.loading && !list.data} />
    </div>
  );
}

/** Approved leave that is running today or starts later, soonest first. */
function AwayPanel({ items, loading }: { items: LeaveRow[]; loading: boolean }) {
  const today = companyToday();
  const away = items
    .filter((l) => l.status === "APPROVED" && l.end >= today)
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 8);
  return (
    <Panel icon="users" title="Away now & upcoming" subtitle="Approved leave from today on" flush>
      {loading ? (
        <ListSkeleton rows={3} />
      ) : away.length ? (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
          {away.map((l) => {
            const now = l.start <= today;
            return (
              <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                <PersonCell name={l.employee.name} meta={`${l.typeName} · ${fmtRange(l.start, l.end)}`} />
                <span className="shrink-0">{now ? <StatusPill status="on_leave" label="Today" /> : <span className="text-xs text-zinc-500 dark:text-zinc-400">{plural(l.days, "day")}</span>}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyBlock icon="calendar" title="Everyone is in" hint="No approved leave today or coming up." />
      )}
    </Panel>
  );
}

function DecisionForm({ item, onClose, onDone }: { item: LeaveRow; onClose: () => void; onDone: () => void }) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "APPROVED" | "REJECTED") {
    setBusy(decision === "APPROVED" ? "approve" : "reject");
    setError(null);
    try {
      await api(`/api/leave-requests/${item.id}/decision`, { body: { decision, comment: comment.trim() || undefined } });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <PersonCell name={item.employee.name} meta={`${item.employee.code} · ${item.employee.department}`} />
      <dl className="grid grid-cols-3 gap-3 rounded-xl bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
        <div>
          <dt className="text-[11px] uppercase tracking-[0.06em] text-zinc-500 dark:text-zinc-400">Type</dt>
          <dd className="mt-0.5 font-medium">{item.typeName}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-[11px] uppercase tracking-[0.06em] text-zinc-500 dark:text-zinc-400">Dates</dt>
          <dd className="mt-0.5 font-medium">
            {fmtRange(item.start, item.end)} · {plural(item.days, "working day")}
          </dd>
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
        <Button type="button" variant="danger" loading={busy === "reject"} disabled={!!busy || !comment.trim()} onClick={() => decide("REJECTED")}>
          <OpsIcon name="x" /> Reject
        </Button>
        <Button type="button" loading={busy === "approve"} disabled={!!busy} onClick={() => decide("APPROVED")}>
          <OpsIcon name="check" /> Approve
        </Button>
      </div>
    </div>
  );
}
