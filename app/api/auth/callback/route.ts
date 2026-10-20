import { NextResponse } from "next/server";
import { keycloak } from "../../lib/keycloak";
import { resolveAuthUserFromAccessToken } from "@/app/api/lib/auth";
import { getPool } from "@/config/db";
import {
  ACTIVE_COMPANY_COOKIE,
  COMPANY_SELECTION_PATH,
  POST_LOGIN_DASHBOARD_PATH,
  isSafePostLoginPath,
  loadCompanyMemberships,
  resolveBrowserRedirectOrigin,
  resolvePostLoginDestination,
} from "@/app/api/lib/company-tenancy";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = resolveBrowserRedirectOrigin(req.url, req.headers.get("x-forwarded-host"));
  const code = url.searchParams.get("code");

  if (!code) {
    return new Response("No authorization code", { status: 400 });
  }

  const tokenResponse = await fetch(keycloak.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: process.env.KEYCLOAK_CLIENT_ID!,
      client_secret: process.env.KEYCLOAK_CLIENT_SECRET!,
      redirect_uri: process.env.KEYCLOAK_REDIRECT_URL!,
      code,
    }),
  });

  const tokenData = await tokenResponse.json();

  if (!tokenResponse.ok) {
    console.error("Token error:", tokenData);
    return new Response("Token exchange failed", { status: 401 });
  }

  const accessToken = String(tokenData?.access_token || "");
  if (!accessToken) {
    console.error("[auth/callback] Token exchange succeeded but access_token missing");
    return new Response("Invalid token response", { status: 401 });
  }

  const resolved = await resolveAuthUserFromAccessToken(accessToken);
  if (!resolved) {
    console.warn("[auth/callback] Keycloak user not found in ACARSH Users table");
    return NextResponse.redirect(new URL("/access_denied", origin), 302);
  }

  const pool = await getPool();
  const memberships = await loadCompanyMemberships(pool, resolved.userId);
  const destination = resolvePostLoginDestination({ memberships, selectedCompanyId: null });
  const location = isSafePostLoginPath(destination.path) ? destination.path : POST_LOGIN_DASHBOARD_PATH;

  console.info("[auth/callback] ACARSH user resolved", {
    userId: resolved.userId,
    roleId: resolved.roleId,
    matchedBy: resolved.matchedBy,
    destination: destination.kind,
  });

  const isProd = process.env.NODE_ENV === "production";
  const response = NextResponse.redirect(new URL(location, origin), 302);
  response.cookies.set("access_token", accessToken, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: isProd,
  });
  if (destination.kind === "dashboard") {
    response.cookies.set(ACTIVE_COMPANY_COOKIE, String(destination.companyId), {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: isProd,
      maxAge: 60 * 60 * 24 * 30,
    });
  } else {
    response.cookies.set(ACTIVE_COMPANY_COOKIE, "", {
      httpOnly: true,
      path: "/",
      maxAge: 0,
    });
  }

  if (location !== POST_LOGIN_DASHBOARD_PATH && location !== COMPANY_SELECTION_PATH) {
    return NextResponse.redirect(new URL(POST_LOGIN_DASHBOARD_PATH, origin), 302);
  }

  return response;
}
