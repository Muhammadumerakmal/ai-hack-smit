import { NextResponse, type NextRequest } from "next/server";

// Cheap redirect for signed-out visitors. Real checks (token signature, active user, role, scope)
// happen on the server for every API call; this only avoids flashing an empty app shell.
export function proxy(req: NextRequest) {
  if (!req.cookies.get("token")?.value) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/employees/:path*",
    "/profile/:path*",
    "/attendance/:path*",
    "/leave/:path*",
    "/payroll/:path*",
    "/payslips/:path*",
    "/announcements/:path*",
    "/users/:path*",
    "/settings/:path*",
    "/audit/:path*",
  ],
};
