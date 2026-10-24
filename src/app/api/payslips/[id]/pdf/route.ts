import { withSession } from "@/lib/api";
import { renderPayslipPdf } from "@/server/pdf";
import { getPayslipDetail } from "@/server/services/payroll.service";

// GET /api/payslips/:id/pdf → payslip PDF (Employee: own finalized only; Admin/HR: any)
export const GET = withSession<{ id: string }>(async (_req, s, { id }) => {
  const slip = await getPayslipDetail(s, id);
  return new Response(renderPayslipPdf(slip), {
    headers: {
      "Content-Type": "application/pdf",
      // Employee codes are typed by HR: keep only filename-safe characters so a quote or newline can't break the header.
      "Content-Disposition": `attachment; filename="payslip-${safeFilePart(slip.employee.code)}-${safeFilePart(slip.month)}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
});

const safeFilePart = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 40) || "x";
