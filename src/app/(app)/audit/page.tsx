"use client";

import { Fragment, useState } from "react";
import { useMe } from "@/components/shell/AppShell";
import { Button, Card, EmptyState, ErrorState, Field, Loading, Notice, PageHeader, Pager, Select, Table, Td } from "@/components/ui";
import { fmtDateTime, qs, useApi } from "@/lib/client";

interface AuditPage {
  page: number;
  pageSize: number;
  total: number;
  filters: { entities: string[]; actions: string[] };
  items: { id: string; createdAt: string; actorName: string; actorRole: string; action: string; entity: string; entityId: string | null; before: unknown; after: unknown }[];
}

// Audit log (#25): Admin view only. Entries are append-only; this page has no edit or delete.
export default function AuditPage() {
  const me = useMe();
  const [filter, setFilter] = useState({ entity: "", action: "" });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const { data, error, loading, reload } = useApi<AuditPage>(me.role === "ADMIN" ? `/api/audit${qs({ ...filter, page })}` : null);

  if (me.role !== "ADMIN") return <Notice tone="warn">Only Admin can view the audit log.</Notice>;

  return (
    <>
      <PageHeader title="Audit log" subtitle="Every create, update, approve and finalize action. Entries cannot be changed or deleted." />
      <Card>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Field label="Entity">
            <Select value={filter.entity} onChange={(e) => (setFilter({ ...filter, entity: e.target.value }), setPage(1))}>
              <option value="">All</option>
              {data?.filters.entities.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </Select>
          </Field>
          <Field label="Action">
            <Select value={filter.action} onChange={(e) => (setFilter({ ...filter, action: e.target.value }), setPage(1))}>
              <option value="">All</option>
              {data?.filters.actions.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </Select>
          </Field>
          <Button variant="secondary" onClick={reload}>
            Refresh
          </Button>
        </div>

        {error && <ErrorState message={error} onRetry={reload} />}
        {loading && !data && <Loading />}
        {data && !data.items.length && <EmptyState title="No entries match" />}
        {data && !!data.items.length && (
          <>
            <Table head={["Time", "Actor", "Action", "Entity", ""]}>
              {data.items.map((x) => (
                <Fragment key={x.id}>
                  <tr>
                    <Td className="whitespace-nowrap text-xs text-zinc-500">{fmtDateTime(x.createdAt)}</Td>
                    <Td>
                      {x.actorName || "—"} <span className="text-xs text-zinc-500">({x.actorRole})</span>
                    </Td>
                    <Td>{x.action.replace(/_/g, " ")}</Td>
                    <Td>
                      {x.entity.replace(/_/g, " ")}
                      {x.entityId && <span className="ml-1 font-mono text-[11px] text-zinc-400">{x.entityId.slice(-8)}</span>}
                    </Td>
                    <Td>
                      {(x.before != null || x.after != null) && (
                        <Button size="sm" variant="ghost" onClick={() => setOpen(open === x.id ? null : x.id)} aria-expanded={open === x.id}>
                          {open === x.id ? "Hide" : "Changes"}
                        </Button>
                      )}
                    </Td>
                  </tr>
                  {open === x.id && (
                    <tr>
                      <td colSpan={5} className="bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
                        <div className="grid gap-3 md:grid-cols-2">
                          <JsonBlock label="Before" value={x.before} />
                          <JsonBlock label="After" value={x.after} />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </Table>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-zinc-500">{label}</p>
      <pre className="max-h-64 overflow-auto rounded bg-white p-2 text-[11px] leading-relaxed dark:bg-zinc-950">{value == null ? "—" : JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}
