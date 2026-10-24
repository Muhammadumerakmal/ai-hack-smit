"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMe } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui";
import { Employee360 } from "../_components/Employee360";

export default function EmployeePage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  // Own record is always self-service (phone & address), even for HR.
  const mode = me.employeeId === id ? "self" : me.role === "HR" ? "hr" : "view";
  return (
    <>
      <PageHeader
        title="Employee 360"
        actions={
          me.role !== "EMPLOYEE" && (
            <Link href="/employees" className="text-sm text-teal-700 hover:underline dark:text-teal-400">
              ← All employees
            </Link>
          )
        }
      />
      <Employee360 id={id} mode={mode} />
    </>
  );
}
