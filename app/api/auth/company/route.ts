import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import { resolveAuthUser } from "@/app/api/lib/auth";
import {
  ACTIVE_COMPANY_COOKIE,
  loadCompanyMemberships,
  membershipsForClient,
  parseRequestedCompanyId,
  selectRequestedMembership,
  shouldShowCompanySelector,
} from "@/app/api/lib/company-tenancy";

function companyCookie(companyId: number) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 30,
    secure: process.env.NODE_ENV === "production",
    value: String(companyId),
  };
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await resolveAuthUser(req);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const requestedCompanyId = parseRequestedCompanyId((body as { companyId?: unknown } | null)?.companyId);
    const pool = await getPool();
    const memberships = await loadCompanyMemberships(pool, authUser.userId);
    const selected = selectRequestedMembership(memberships, requestedCompanyId);

    if (!selected.ok) {
      const status = selected.reason === "INVALID_COMPANY" ? 400 : 403;
      const error =
        selected.reason === "NO_MEMBERSHIP"
          ? "Company membership required"
          : selected.reason === "NOT_A_MEMBER"
            ? "Not a member of the requested company"
            : "Invalid company";
      return NextResponse.json({ error }, { status });
    }

    const visible = membershipsForClient(memberships);
    const cookie = companyCookie(selected.membership.companyId);
    const response = NextResponse.json({
      companyId: selected.membership.companyId,
      companyName:
        selected.membership.companyName ||
        visible.find((row) => row.companyId === selected.membership.companyId)?.companyName ||
        null,
      roleId: selected.membership.roleId,
      memberships: visible,
      showCompanySelector: shouldShowCompanySelector(memberships),
    });
    response.cookies.set(ACTIVE_COMPANY_COOKIE, cookie.value, {
      httpOnly: cookie.httpOnly,
      path: cookie.path,
      sameSite: cookie.sameSite,
      maxAge: cookie.maxAge,
      secure: cookie.secure,
    });
    return response;
  } catch (error) {
    console.error("[auth/company] POST error", error);
    return NextResponse.json({ error: "Failed to switch company" }, { status: 500 });
  }
}
