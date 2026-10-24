"use client";

import { useState } from "react";
import { useMe } from "@/components/shell/AppShell";
import { Card, EmptyState, ErrorState, Field, Input, Loading, PageHeader, StatusBadge, Table, Td } from "@/components/ui";
import { money, qs, useApi } from "@/lib/client";

interface Payslip {
  id: string;
  month: string;
  status: string;
  code: string;
  name: string;
  department: string;
  gross: number;
  deductions: number;
  tax: number;
  net: number;
}

// Employees see their own finalized payslips; Admin/HR see everyone's (filter by month).
export default function PayslipsPage() {
  const me = useMe();
  const staff = me.role !== "EMPLOYEE";
  const [month, setMonth] = useState("");
  const { data, error, loading, reload } = useApi<{ items: Payslip[] }>(`/api/payslips${qs({ month })}`);

  return (
    <div className="space-y-6">
      <PageHeader title={staff ? "Payslips" : "My payslips"} subtitle={staff ? "All payslips. Drafts can still change until Admin finalizes the month." : "Payslips appear here once the month is finalized."} />
      <Card>
        {staff && (
          <div className="mb-4 w-44">
            <Field label="Month">
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </Field>
          </div>
        )}
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data?.items.length ? (
          <EmptyState title="No payslips yet" hint={staff ? "Run payroll for a month first." : "You'll be notified when your payslip is ready."} />
        ) : (
          <Table head={staff ? ["Month", "Employee", "Department", "Status", "Gross", "Net", ""] : ["Month", "Gross", "Deductions", "Tax", "Net", ""]}>
            {data.items.map((p) => (
              <tr key={p.id}>
                <Td>{p.month}</Td>
                {staff && (
                  <>
                    <Td>
                      {p.name} <span className="text-xs text-zinc-500">{p.code}</span>
                    </Td>
                    <Td>{p.department}</Td>
                    <Td>
                      <StatusBadge status={p.status} />
                    </Td>
                  </>
                )}
                <Td className="tabular-nums">{money(p.gross)}</Td>
                {!staff && (
                  <>
                    <Td className="tabular-nums">{money(p.deductions)}</Td>
                    <Td className="tabular-nums">{money(p.tax)}</Td>
                  </>
                )}
                <Td className="tabular-nums font-medium">{money(p.net)}</Td>
                <Td>
                  <a href={`/api/payslips/${p.id}/pdf`} className="text-sm font-medium text-teal-700 hover:underline dark:text-teal-400">
                    Download PDF
                  </a>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
