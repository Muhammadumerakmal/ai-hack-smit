"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Avatar,
  FormSection,
  PIcon,
  PagerBar,
  Panel,
  RowsSkeleton,
  SearchInput,
  SecretReveal,
  Surface,
  ToolButton,
  cx,
  selectCls,
} from "@/components/people/kit";
import { useMe } from "@/components/shell/AppShell";
import { Button, EmptyState, ErrorState, Field, Input, Notice, PageHeader, Select, StatusBadge, Textarea } from "@/components/ui";
import { api, fmtDate, money, qs, useApi } from "@/lib/client";

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
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export default function EmployeesPage() {
  const me = useMe();
  const router = useRouter();
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
  const filtered = !!(debounced || departmentId || status);

  function clearFilters() {
    setSearch("");
    setDebounced("");
    setDepartmentId("");
    setStatus("");
    setPage(1);
  }

  return (
    <>
      <PageHeader
        title="Employees"
        subtitle={isHr ? "Register people, keep their details and salaries current, and move data in or out with CSV." : "Company directory. Only HR can register or edit employees."}
        actions={
          isHr && (
            <>
              {/* A plain GET form downloads the CSV (an API route, not a page). */}
              <form action="/api/employees/export" method="get">
                <ToolButton type="submit" icon="download">
                  Export
                </ToolButton>
              </form>
              <ToolButton icon="upload" onClick={() => setModal("import")}>
                Import
              </ToolButton>
              <ToolButton icon="plus" variant="primary" onClick={() => setModal("register")}>
                Register employee
              </ToolButton>
            </>
          )
        }
      />

      <Surface className="overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-col gap-3 border-b border-zinc-200/80 p-4 sm:p-5 lg:flex-row lg:items-center dark:border-zinc-800/80">
          <SearchInput value={search} onChange={setSearch} placeholder="Search by name, code, email or phone" label="Search employees" />
          <div className="grid grid-cols-2 gap-3 lg:flex lg:w-auto">
            <select
              className={cx(selectCls, "lg:w-48")}
              value={departmentId}
              onChange={(e) => {
                setDepartmentId(e.target.value);
                setPage(1);
              }}
              aria-label="Department"
            >
              <option value="">All departments</option>
              {depts.data?.items.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <select
              className={cx(selectCls, "lg:w-40")}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              aria-label="Status"
            >
              <option value="">Any status</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
          </div>
          {filtered && (
            <button onClick={clearFilters} className="h-10 shrink-0 self-start rounded-lg px-2 text-sm font-medium text-teal-700 hover:underline lg:self-auto dark:text-teal-400">
              Clear filters
            </button>
          )}
        </div>

        {list.error ? (
          <div className="p-5">
            <ErrorState message={list.error} onRetry={list.reload} />
          </div>
        ) : list.loading && !list.data ? (
          <RowsSkeleton />
        ) : !list.data?.items.length ? (
          <div className="p-5">
            <EmptyState
              title={filtered ? "No employees match these filters" : "No employees yet"}
              hint={filtered ? "Try a different name or clear the filters." : isHr ? "Register the first employee, or import a CSV with several at once." : "HR hasn't registered anyone yet."}
              action={
                filtered ? (
                  <Button size="sm" variant="secondary" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : isHr ? (
                  <Button size="sm" onClick={() => setModal("register")}>
                    Register employee
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <div className={cx("transition-opacity", list.loading && "opacity-60")}>
            {/* Desktop / tablet table */}
            <div className="hidden md:block">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200/80 bg-zinc-50/70 text-[11px] uppercase tracking-[0.06em] text-zinc-500 dark:border-zinc-800/80 dark:bg-zinc-900/40">
                    <th className="px-5 py-3 font-medium">Employee</th>
                    <th className="px-3 py-3 font-medium">Code</th>
                    <th className="px-3 py-3 font-medium">Department</th>
                    <th className="hidden px-3 py-3 font-medium lg:table-cell">Designation</th>
                    <th className="hidden px-3 py-3 font-medium xl:table-cell">Joined</th>
                    <th className="px-3 py-3 font-medium">Status</th>
                    <th className="w-10 px-3 py-3" aria-label="Open" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
                  {list.data.items.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => router.push(`/employees/${r.id}`)}
                      className="group cursor-pointer transition-colors hover:bg-teal-50/40 dark:hover:bg-teal-950/20"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={r.fullName} />
                          <div className="min-w-0">
                            <Link
                              href={`/employees/${r.id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="block truncate font-medium text-zinc-900 hover:text-teal-700 dark:text-zinc-100 dark:hover:text-teal-400"
                            >
                              {r.fullName}
                            </Link>
                            <p className="truncate text-xs text-zinc-500">{r.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-400">{r.code}</td>
                      <td className="px-3 py-3 text-zinc-700 dark:text-zinc-300">{r.department}</td>
                      <td className="hidden px-3 py-3 text-zinc-600 lg:table-cell dark:text-zinc-400">{r.designation ?? "—"}</td>
                      <td className="hidden whitespace-nowrap px-3 py-3 text-zinc-600 xl:table-cell dark:text-zinc-400">{fmtDate(r.joinDate)}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap items-center gap-1">
                          <StatusBadge status={r.status} />
                          {r.role === "HR" && (
                            <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 ring-1 ring-inset ring-violet-600/20 dark:bg-violet-950 dark:text-violet-300">
                              HR
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-zinc-300 group-hover:text-teal-600 dark:text-zinc-600">
                        <PIcon name="chevronRight" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Phone cards */}
            <ul className="divide-y divide-zinc-100 md:hidden dark:divide-zinc-800/70">
              {list.data.items.map((r) => (
                <li key={r.id}>
                  <Link href={`/employees/${r.id}`} className="flex items-start gap-3 px-4 py-3.5 active:bg-zinc-50 dark:active:bg-zinc-900">
                    <Avatar name={r.fullName} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate font-medium">{r.fullName}</p>
                        <StatusBadge status={r.status} />
                      </div>
                      <p className="mt-0.5 truncate text-xs text-zinc-500">
                        <span className="font-mono">{r.code}</span> · {r.department}
                        {r.designation ? ` · ${r.designation}` : ""}
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-400">Joined {fmtDate(r.joinDate)}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>

            <PagerBar page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} noun={list.data.total === 1 ? "employee" : "employees"} />
          </div>
        )}
      </Surface>

      {modal === "register" && <RegisterModal depts={depts.data?.items ?? []} onClose={() => setModal(null)} onDone={list.reload} />}
      {modal === "import" && <ImportModal onClose={() => setModal(null)} onDone={list.reload} />}
    </>
  );
}

// ---------- Register ----------

function RegisterModal({ depts, onClose, onDone }: { depts: Option[]; onClose: () => void; onDone: () => void }) {
  const desigs = useApi<{ items: Option[] }>("/api/org/designations");
  const [f, setF] = useState({ fullName: "", email: "", code: "", phone: "", gender: "", departmentId: "", designationId: "", joinDate: "", status: "PROBATION", basicSalary: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ code: string; email: string; tempPassword: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  const basic = Number(f.basicSalary);
  const preview = useMemo(() => (basic > 0 ? { hra: basic * 0.4, medical: basic * 0.1, gross: basic * 1.5 } : null), [basic]);

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

  if (created) {
    return (
      <Panel open size="sm" title="Employee registered" description={`${created.code} was created along with a login.`} onClose={onClose} footer={<Button onClick={onClose}>Done</Button>}>
        <SecretReveal email={created.email} secret={created.tempPassword} note="This temporary password is shown only once." />
      </Panel>
    );
  }

  return (
    <Panel
      open
      size="lg"
      title="Register employee"
      description="This also creates their login. You'll get a one-time temporary password to share."
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="register-employee" loading={busy} disabled={depts.length === 0}>
            Register employee
          </Button>
        </>
      }
    >
      <form id="register-employee" onSubmit={submit} className="space-y-6">
        {error && <Notice tone="error">{error}</Notice>}
        {depts.length === 0 && <Notice tone="warn">The Admin must add a department first (Company setup → Departments).</Notice>}

        <FormSection title="Personal">
          <Field label="Full name">
            <Input required minLength={2} value={f.fullName} onChange={set("fullName")} autoComplete="off" placeholder="e.g. Ayesha Khan" />
          </Field>
          <Field label="Work email" hint="This becomes their login.">
            <Input required type="email" value={f.email} onChange={set("email")} autoComplete="off" placeholder="name@company.pk" />
          </Field>
          <Field label="Phone">
            <Input type="tel" value={f.phone} onChange={set("phone")} placeholder="03xx-xxxxxxx" />
          </Field>
          <Field label="Gender">
            <Select value={f.gender} onChange={set("gender")}>
              <option value="">Prefer not to say</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </Select>
          </Field>
        </FormSection>

        <FormSection title="Job">
          <Field label="Department">
            <Select required value={f.departmentId} onChange={set("departmentId")}>
              <option value="">Select a department</option>
              {depts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Designation">
            <Select value={f.designationId} onChange={set("designationId")}>
              <option value="">Not set</option>
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
          <Field label="Employment status">
            <Select value={f.status} onChange={set("status")}>
              <option value="PROBATION">Probation</option>
              <option value="ACTIVE">Active</option>
            </Select>
          </Field>
          <Field label="Employee code" hint="Leave empty to generate the next one (E0001…).">
            <Input value={f.code} onChange={set("code")} maxLength={20} className="font-mono" />
          </Field>
        </FormSection>

        <FormSection title="Salary" hint="Allowances follow company policy: HRA 40% and medical 10% of basic.">
          <Field label="Basic salary (PKR / month)">
            <Input required type="number" min={1} step="1" inputMode="numeric" value={f.basicSalary} onChange={set("basicSalary")} placeholder="e.g. 100000" />
          </Field>
          <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-3.5 text-sm dark:border-zinc-800 dark:bg-zinc-900/40" aria-live="polite">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">Monthly structure</p>
            <dl className="mt-2 space-y-1.5">
              <PreviewRow k="Basic" v={preview ? money(basic) : "—"} />
              <PreviewRow k="HRA (40%)" v={preview ? money(preview.hra) : "—"} />
              <PreviewRow k="Medical (10%)" v={preview ? money(preview.medical) : "—"} />
              <div className="border-t border-zinc-200 pt-1.5 dark:border-zinc-800">
                <PreviewRow k="Gross" v={preview ? money(preview.gross) : "—"} strong />
              </div>
            </dl>
          </div>
        </FormSection>
      </form>
    </Panel>
  );
}

function PreviewRow({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-zinc-500">{k}</dt>
      <dd className={cx("tabular-nums", strong ? "font-semibold text-teal-700 dark:text-teal-400" : "text-zinc-800 dark:text-zinc-200")}>{v}</dd>
    </div>
  );
}

// ---------- CSV import (stepper) ----------

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
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const step = result && !result.dryRun ? 3 : result ? 2 : 1;
  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`;

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

  const footer =
    step === 3 ? (
      <Button onClick={onClose}>Done</Button>
    ) : (
      <>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        {step === 2 && (
          <Button variant="secondary" onClick={() => setResult(null)}>
            Back
          </Button>
        )}
        {step === 1 ? (
          <Button onClick={() => run(true)} loading={busy} disabled={!csv.trim()}>
            Check file
          </Button>
        ) : (
          <Button onClick={() => run(false)} loading={busy} disabled={!result?.dryRun || result.errors.length > 0}>
            Import {result?.valid ?? ""} employee{result?.valid === 1 ? "" : "s"}
          </Button>
        )}
      </>
    );

  return (
    <Panel open size="lg" title="Import employees" description="Nothing is saved until the file passes the check and you confirm." onClose={onClose} footer={footer}>
      <ol className="mb-6 grid grid-cols-3 gap-2" aria-label="Import steps">
        {["Add file", "Review", "Done"].map((s, i) => {
          const n = i + 1;
          const state = n < step ? "done" : n === step ? "current" : "todo";
          return (
            <li key={s} className="flex flex-col gap-2" aria-current={state === "current" ? "step" : undefined}>
              <span className={cx("h-1 rounded-full", state === "todo" ? "bg-zinc-200 dark:bg-zinc-800" : "bg-teal-500")} />
              <span className={cx("text-xs font-medium", state === "todo" ? "text-zinc-400" : "text-zinc-800 dark:text-zinc-200")}>
                {n}. {s}
              </span>
            </li>
          );
        })}
      </ol>

      {step === 1 && (
        <div className="space-y-4 text-sm">
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-zinc-300 px-4 py-7 text-center transition-colors hover:border-teal-400 hover:bg-teal-50/30 dark:border-zinc-700 dark:hover:bg-teal-950/20">
            <PIcon name="upload" className="h-6 w-6 text-teal-600" />
            <span className="font-medium">{fileName ?? "Choose a CSV file"}</span>
            <span className="text-xs text-zinc-500">or paste the rows below</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setCsv(await file.text());
                  setFileName(file.name);
                  setResult(null);
                }
              }}
            />
          </label>
          <Textarea
            rows={6}
            value={csv}
            onChange={(e) => {
              setCsv(e.target.value);
              setResult(null);
            }}
            placeholder={TEMPLATE}
            className="font-mono text-xs"
            aria-label="CSV rows"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
            <span>Columns: code, full_name, email, phone, department, designation, join_date (YYYY-MM-DD), basic_salary, gender, status.</span>
            <a href={templateHref} download="employees-template.csv" className="font-medium text-teal-700 hover:underline dark:text-teal-400">
              Download template
            </a>
          </div>
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      )}

      {step === 2 && result && (
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-3 gap-3">
            <Tally label="Rows" value={result.total} />
            <Tally label="Valid" value={result.valid} tone="good" />
            <Tally label="Problems" value={result.errors.length} tone={result.errors.length ? "bad" : "default"} />
          </div>
          {result.errors.length > 0 ? (
            <>
              <Notice tone="warn">Fix these rows in your file, then go back and check it again.</Notice>
              <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
                <div className="max-h-72 overflow-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-zinc-50 text-[11px] uppercase tracking-[0.06em] text-zinc-500 dark:bg-zinc-900">
                      <tr>
                        <th className="px-3 py-2 font-medium">Row</th>
                        <th className="px-3 py-2 font-medium">Field</th>
                        <th className="px-3 py-2 font-medium">Reason</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
                      {result.errors.map((x, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2 tabular-nums">{x.row}</td>
                          <td className="px-3 py-2 font-mono text-xs">{x.field}</td>
                          <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{x.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <Notice tone="success">
              All {result.valid} row{result.valid === 1 ? " is" : "s are"} valid. Import to create {result.valid === 1 ? "the employee and their login" : "the employees and their logins"}.
            </Notice>
          )}
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      )}

      {step === 3 && result && (
        <div className="space-y-4 text-sm">
          <Notice tone="success">
            Imported {result.created.length} employee{result.created.length === 1 ? "" : "s"}. Share each temporary password privately; it is shown only once and must be changed at first sign-in.
          </Notice>
          <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-800/70 dark:border-zinc-800">
            {result.created.map((c) => (
              <li key={c.email} className="flex flex-col gap-1 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium">
                    {c.fullName} <span className="font-mono text-xs text-zinc-500">{c.code}</span>
                  </p>
                  <p className="truncate text-xs text-zinc-500">{c.email}</p>
                </div>
                <code className="w-fit rounded-md bg-zinc-100 px-2 py-1 font-mono text-sm tracking-wider select-all dark:bg-zinc-900">{c.tempPassword}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function Tally({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "good" | "bad" }) {
  const c = { default: "text-zinc-900 dark:text-zinc-100", good: "text-teal-700 dark:text-teal-400", bad: "text-red-600 dark:text-red-400" }[tone];
  return (
    <div className="rounded-xl border border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
      <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-zinc-500">{label}</p>
      <p className={cx("mt-1 text-xl font-semibold tabular-nums", c)}>{value}</p>
    </div>
  );
}
