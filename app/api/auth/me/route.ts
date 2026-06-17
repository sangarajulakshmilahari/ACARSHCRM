import { NextRequest, NextResponse } from "next/server";
import { getTokenIdentityFromRequest, resolveAuthUser } from "@/app/api/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const identity = getTokenIdentityFromRequest(req);
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

    console.info("[auth/me] User resolved", {
      userId: resolved.userId,
      roleId: resolved.roleId,
      matchedBy: resolved.matchedBy,
    });

    return NextResponse.json({
      name: resolved.userName,
      userId: resolved.userId,
      roleId: resolved.roleId,
    });
  } catch (err) {
    console.error("[auth/me] Error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
