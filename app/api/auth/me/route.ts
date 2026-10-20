import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import { getTokenIdentityFromRequest, resolveAuthUser } from "@/app/api/lib/auth";
import {
  loadCompanyMemberships,
  membershipsForClient,
  shouldShowCompanySelector,
} from "@/app/api/lib/company-tenancy";

export async function GET(req: NextRequest) {
  try {
    const identity = await getTokenIdentityFromRequest(req);
    if (!identity) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const resolved = await resolveAuthUser(req);
    if (!resolved) {
      console.warn("[auth/me] Token identity exists but no ACARSH user mapping", {
        keycloakId: identity.keycloakId || null,
        userName: identity.userName || null,
        email: identity.email || null,
      });

      return NextResponse.json(
        { error: "User not found in ACARSH for SSO identity" },
        { status: 404 }
      );
    }

    const pool = await getPool();
    const memberships = await loadCompanyMemberships(pool, resolved.userId);
    const visible = membershipsForClient(memberships);
    const selected = visible.find((row) => row.companyId === resolved.companyId) || null;

    console.info("[auth/me] User resolved", {
      userId: resolved.userId,
      roleId: resolved.roleId,
      matchedBy: resolved.matchedBy,
    });

    return NextResponse.json({
      name: resolved.userName,
      userId: resolved.userId,
      roleId: resolved.roleId,
      companyId: resolved.companyId,
      companyName: selected?.companyName ?? null,
      memberships: visible,
      showCompanySelector: shouldShowCompanySelector(memberships),
      accessError: visible.length === 0 ? "Company membership required" : null,
    });
  } catch (err) {
    console.error("[auth/me] Error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
