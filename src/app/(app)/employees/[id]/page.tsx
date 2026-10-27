"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { PIcon } from "@/components/people/kit";
import { useMe } from "@/components/shell/AppShell";
import { Employee360 } from "../_components/Employee360";

export default function EmployeePage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  // Own record is always self-service (phone & address), even for HR.
  const mode = me.employeeId === id ? "self" : me.role === "HR" ? "hr" : "view";
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
        {me.role !== "EMPLOYEE" ? (
          <Link href="/employees" className="inline-flex items-center gap-1.5 rounded-md py-1 font-medium text-zinc-600 hover:text-teal-700 dark:text-zinc-300 dark:hover:text-teal-400">
            <PIcon name="arrowLeft" />
            Employees
          </Link>
        ) : (
          <span>Employees</span>
        )}
        <PIcon name="chevronRight" className="h-3.5 w-3.5 text-zinc-300 dark:text-zinc-600" />
        <span className="text-zinc-800 dark:text-zinc-200">Employee profile</span>
      </nav>
      <Employee360 id={id} mode={mode} />
    </>
  );
}
