"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useMe } from "@/components/shell/AppShell";
import { Button, Card, EmptyState, ErrorState, Field, Input, Loading, Modal, Notice, PageHeader, Pager, Select, StatusBadge, Table, Td, Textarea } from "@/components/ui";
import { api, fmtDate, qs, useApi } from "@/lib/client";

interface Row {
  id: string;
  code: string;
  fullName: string;
  email: string;
  department: string;
  designation: string | null;
  status: string;
  joinDate: string;
  role: string | null;
  loginActive: boolean;
}
interface Page {
  page: number;
  pageSize: number;
  total: number;
  items: Row[];
}
interface Option {
  id: string;
  name: string;
}

const STATUSES = ["ACTIVE", "PROBATION", "INACTIVE", "EXITED"];

export default function EmployeesPage() {
  const me = useMe();
  const isHr = me.role === "HR";
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<"register" | "import" | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const list = useApi<Page>(`/api/employees${qs({ search: debounced, departmentId, status, page, pageSize: 20 })}`);
  const depts = useApi<{ items: Option[] }>("/api/org/departments");

  return (
    <>
      <PageHeader
        title="Employees"
        subtitle={isHr ? "Register people, edit details and salaries, import or export CSV." : "Company directory (view only)."}
        actions={
          isHr && (
            <>
              {/* A plain GET form downloads the CSV (an API route, not a page). */}
              <form action="/api/employees/export" method="get">
                <Button type="submit" variant="secondary">
                  Export CSV
                </Button>
              </form>
              <Button variant="secondary" onClick={() => setModal("import")}>
                Import CSV
              </Button>
              <Button onClick={() => setModal("register")}>Register employee</Button>
            </>
          )
        }
      />

      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Input placeholder="Search name, code, email, phone…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
          <Select value={departmentId} onChange={(e) => (setDepartmentId(e.target.value), setPage(1))} aria-label="Department">
            <option value="">All departments</option>
            {depts.data?.items.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} aria-label="Status">
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.toLowerCase()}
              </option>
            ))}
          </Select>
        </div>

        {list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : list.loading && !list.data ? (
          <Loading />
        ) : !list.data?.items.length ? (
          <EmptyState
            title={debounced || departmentId || status ? "No employees match these filters" : "No employees yet"}
            hint={isHr ? "Register the first employee or import a CSV." : undefined}
          />
        ) : (
          <>
            <Table head={["Code", "Name", "Department", "Designation", "Joined", "Status"]}>
              {list.data.items.map((r) => (
                <tr key={r.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900">
                  <Td className="font-mono text-xs">{r.code}</Td>
                  <Td>
                    <Link href={`/employees/${r.id}`} className="font-medium text-teal-700 hover:underline dark:text-teal-400">
                      {r.fullName}
                    </Link>
                    <p className="text-xs text-zinc-500">{r.email}</p>
                  </Td>
                  <Td>{r.department}</Td>
                  <Td>{r.designation ?? "—"}</Td>
                  <Td>{fmtDate(r.joinDate)}</Td>
                  <Td>
                    <StatusBadge status={r.status} />
                  </Td>
                </tr>
              ))}
            </Table>
            <Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>

      {modal === "register" && <RegisterModal depts={depts.data?.items ?? []} onClose={() => setModal(null)} onDone={list.reload} />}
      {modal === "import" && <ImportModal onClose={() => setModal(null)} onDone={list.reload} />}
    </>
  );
}

function RegisterModal({ depts, onClose, onDone }: { depts: Option[]; onClose: () => void; onDone: () => void }) {
  const desigs = useApi<{ items: Option[] }>("/api/org/designations");
  const [f, setF] = useState({ fullName: "", email: "", code: "", phone: "", gender: "", departmentId: "", designationId: "", joinDate: "", status: "PROBATION", basicSalary: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ code: string; email: string; tempPassword: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ code: string; email: string; tempPassword: string }>("/api/employees", {
        body: {
          ...f,
          code: f.code || undefined,
          phone: f.phone || null,
          gender: f.gender || null,
          designationId: f.designationId || null,
          basicSalary: Number(f.basicSalary),
        },
      });
      setCreated(r);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={created ? "Employee registered" : "Register employee"} onClose={onClose}>
      {created ? (
        <div className="space-y-3 text-sm">
          <Notice tone="success">
            {created.code} created. A login was made for <b>{created.email}</b>.
          </Notice>
          <p>Give them this temporary password. It is shown only once; they must change it at first sign-in.</p>
          <p className="rounded-lg bg-zinc-100 px-3 py-2 text-center font-mono text-lg tracking-wide dark:bg-zinc-900">{created.tempPassword}</p>
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          {error && (
            <div className="sm:col-span-2">
              <Notice tone="error">{error}</Notice>
            </div>
          )}
          <Field label="Full name">
            <Input required minLength={2} value={f.fullName} onChange={set("fullName")} />
          </Field>
          <Field label="Email (becomes their login)">
            <Input required type="email" value={f.email} onChange={set("email")} />
          </Field>
          <Field label="Department">
            <Select required value={f.departmentId} onChange={set("departmentId")}>
              <option value="">Select…</option>
              {depts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Designation">
            <Select value={f.designationId} onChange={set("designationId")}>
              <option value="">—</option>
              {desigs.data?.items.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Join date">
            <Input required type="date" value={f.joinDate} onChange={set("joinDate")} />
          </Field>
          <Field label="Basic salary (PKR / month)" hint="Gross = 1.5 × basic">
            <Input required type="number" min={1} value={f.basicSalary} onChange={set("basicSalary")} />
          </Field>
          <Field label="Status">
            <Select value={f.status} onChange={set("status")}>
              <option value="PROBATION">probation</option>
              <option value="ACTIVE">active</option>
            </Select>
          </Field>
          <Field label="Gender">
            <Select value={f.gender} onChange={set("gender")}>
              <option value="">—</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Phone">
            <Input value={f.phone} onChange={set("phone")} />
          </Field>
          <Field label="Employee code" hint="Leave empty to generate (E0001…)">
            <Input value={f.code} onChange={set("code")} maxLength={20} />
          </Field>
          {depts.length === 0 && (
            <div className="sm:col-span-2">
              <Notice tone="warn">Admin must add a department first (Company setup).</Notice>
            </div>
          )}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Register
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

interface ImportResult {
  dryRun: boolean;
  total: number;
  valid: number;
  errors: { row: number; field: string; reason: string }[];
  created: { code: string; email: string; fullName: string; tempPassword: string }[];
}

const TEMPLATE = "code,full_name,email,phone,department,designation,join_date,basic_salary,gender,status\nE0100,Ayesha Khan,ayesha@company.pk,0300-0000000,Engineering,,2026-10-01,120000,female,PROBATION\n";

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(dryRun: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await api<ImportResult>("/api/employees/import", { body: { csv, dryRun } });
      setResult(r);
      if (!r.dryRun) onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title="Import employees from CSV" onClose={onClose}>
      <div className="space-y-3 text-sm">
        {!result?.created.length && (
          <>
            <p className="text-zinc-600 dark:text-zinc-400">
              Columns: code, full_name, email, phone, department, designation, join_date (YYYY-MM-DD), basic_salary, gender, status. First check the file; nothing is saved until you import.
            </p>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setCsv(await file.text());
                  setResult(null);
                }
              }}
            />
            <Textarea rows={6} value={csv} onChange={(e) => (setCsv(e.target.value), setResult(null))} placeholder={TEMPLATE} className="font-mono text-xs" />
            {error && <Notice tone="error">{error}</Notice>}
          </>
        )}

        {result && result.errors.length > 0 && (
          <>
            <Notice tone="warn">
              {result.errors.length} problem(s) in {result.total} row(s). Fix the file and check again.
            </Notice>
            <Table head={["Row", "Field", "Reason"]}>
              {result.errors.map((x, i) => (
                <tr key={i}>
                  <Td>{x.row}</Td>
                  <Td className="font-mono text-xs">{x.field}</Td>
                  <Td>{x.reason}</Td>
                </tr>
              ))}
            </Table>
          </>
        )}
        {result?.dryRun && result.errors.length === 0 && <Notice tone="success">All {result.valid} row(s) are valid. Ready to import.</Notice>}
        {result && !result.dryRun && (
          <>
            <Notice tone="success">Imported {result.created.length} employee(s). Share each temporary password once; it must be changed at first sign-in.</Notice>
            <Table head={["Code", "Name", "Email", "Temp password"]}>
              {result.created.map((c) => (
                <tr key={c.email}>
                  <Td>{c.code}</Td>
                  <Td>{c.fullName}</Td>
                  <Td>{c.email}</Td>
                  <Td className="font-mono">{c.tempPassword}</Td>
                </tr>
              ))}
            </Table>
          </>
        )}

        <div className="flex justify-end gap-2">
          {result && !result.dryRun ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => run(true)} loading={busy} disabled={!csv.trim()}>
                Check file
              </Button>
              <Button onClick={() => run(false)} loading={busy} disabled={!result?.dryRun || result.errors.length > 0}>
                Import {result?.valid ?? ""} employee(s)
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
