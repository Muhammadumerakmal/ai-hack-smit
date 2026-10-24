"use client";

import { useMe } from "@/components/shell/AppShell";
import { EmptyState, PageHeader } from "@/components/ui";
import { Employee360 } from "../employees/_components/Employee360";

export default function ProfilePage() {
  const me = useMe();
  return (
    <>
      <PageHeader title="My profile" subtitle="Your details, salary structure, attendance, leave and payslips. You can update your phone and address." />
      {me.employeeId ? (
        <Employee360 id={me.employeeId} mode="self" />
      ) : (
        <EmptyState title="No employee record" hint="Your login is not linked to an employee record. Ask HR to register you as an employee." />
      )}
    </>
  );
}
