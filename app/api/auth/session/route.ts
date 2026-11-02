import { NextRequest, NextResponse } from "next/server";

import { getTokenIdentityFromAccessToken } from "@/app/api/lib/auth";
import {
  KEYCLOAK_ACCESS_COOKIE,
  KEYCLOAK_REFRESH_COOKIE,
  accessTokenNeedsRefresh,
  applyKeycloakSessionCookies,
  clearKeycloakSessionCookies,
  refreshKeycloakTokens,
} from "@/app/api/lib/keycloak-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const accessToken = String(req.cookies.get(KEYCLOAK_ACCESS_COOKIE)?.value || "").trim();
  const refreshToken = String(req.cookies.get(KEYCLOAK_REFRESH_COOKIE)?.value || "").trim();

  if (accessToken && !accessTokenNeedsRefresh(accessToken)) {
    const identity = await getTokenIdentityFromAccessToken(accessToken);
    if (identity) {
      return NextResponse.json({ ok: true, refreshed: false });
    }
  }

  if (refreshToken) {
    try {
      const tokens = await refreshKeycloakTokens(refreshToken);
      const response = NextResponse.json({ ok: true, refreshed: true });
      applyKeycloakSessionCookies(response, tokens);
      return response;
    } catch {
      // Fall through and accept a still-valid access token if Keycloak refresh fails.
    }
  }

  if (accessToken) {
    const identity = await getTokenIdentityFromAccessToken(accessToken);
    if (identity) {
      return NextResponse.json({ ok: true, refreshed: false });
    }
  }

  const response = NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (refreshToken) clearKeycloakSessionCookies(response);
  return response;
}
