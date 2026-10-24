import { withSession } from "@/lib/api";
import { renderPayslipPdf } from "@/server/pdf";
import { getPayslipDetail } from "@/server/services/payroll.service";

// GET /api/payslips/:id/pdf → payslip PDF (Employee: own finalized only; Admin/HR: any)
export const GET = withSession<{ id: string }>(async (_req, s, { id }) => {
  const slip = await getPayslipDetail(s, id);
  return new Response(renderPayslipPdf(slip), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="payslip-${slip.employee.code}-${slip.month}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
});
