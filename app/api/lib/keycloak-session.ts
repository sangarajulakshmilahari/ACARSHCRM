import { NextResponse } from "next/server";

import { getKeycloakRealmBaseUrl } from "./keycloak";

export const KEYCLOAK_ACCESS_COOKIE = "access_token";
export const KEYCLOAK_REFRESH_COOKIE = "refresh_token";
export const ACCESS_TOKEN_REFRESH_SKEW_SECONDS = 90;

export type KeycloakSessionTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds: number;
  refreshExpiresInSeconds?: number;
};

function cookieBase() {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}

export function readJwtExpEpoch(token: string): number | null {
  const parts = String(token || "").split(".");
  if (parts.length < 2) return null;
  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    const exp = Number(payload?.exp);
    return Number.isFinite(exp) && exp > 0 ? exp : null;
  } catch {
    return null;
  }
}

export function accessTokenNeedsRefresh(
  token: string,
  nowEpochSeconds = Math.floor(Date.now() / 1000),
  skewSeconds = ACCESS_TOKEN_REFRESH_SKEW_SECONDS,
): boolean {
  if (!String(token || "").trim()) return true;
  const exp = readJwtExpEpoch(token);
  if (!exp) return true;
  return exp - nowEpochSeconds <= skewSeconds;
}

export function expiresInFromTokenResponse(data: { expires_in?: unknown } | null | undefined, accessToken: string): number {
  const claimed = Number(data?.expires_in);
  if (Number.isFinite(claimed) && claimed > 0) return Math.floor(claimed);
  const exp = readJwtExpEpoch(accessToken);
  if (exp) return Math.max(60, exp - Math.floor(Date.now() / 1000));
  return 300;
}

export function applyKeycloakSessionCookies(response: NextResponse, tokens: KeycloakSessionTokens) {
  const accessMaxAge = Math.max(60, Math.floor(Number(tokens.expiresInSeconds) || 300));
  response.cookies.set(KEYCLOAK_ACCESS_COOKIE, tokens.accessToken, {
    ...cookieBase(),
    maxAge: accessMaxAge,
  });
  const refreshToken = String(tokens.refreshToken || "").trim();
  if (refreshToken) {
    const refreshMaxAge = Math.max(
      accessMaxAge,
      Math.floor(Number(tokens.refreshExpiresInSeconds) || 0) || 60 * 60 * 8,
    );
    response.cookies.set(KEYCLOAK_REFRESH_COOKIE, refreshToken, {
      ...cookieBase(),
      maxAge: refreshMaxAge,
    });
  }
}

export function clearKeycloakSessionCookies(response: NextResponse) {
  response.cookies.set(KEYCLOAK_ACCESS_COOKIE, "", { ...cookieBase(), maxAge: 0 });
  response.cookies.set(KEYCLOAK_REFRESH_COOKIE, "", { ...cookieBase(), maxAge: 0 });
}

export async function refreshKeycloakTokens(refreshToken: string): Promise<KeycloakSessionTokens> {
  const realmBaseUrl = getKeycloakRealmBaseUrl();
  const tokenUrl = realmBaseUrl ? `${realmBaseUrl}/protocol/openid-connect/token` : "";
  const clientId = String(process.env.KEYCLOAK_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.KEYCLOAK_CLIENT_SECRET || "").trim();
  const token = String(refreshToken || "").trim();
  if (!tokenUrl || !clientId || !clientSecret || !token) {
    throw new Error("Keycloak refresh is not configured.");
  }

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: token,
    }),
  });
  const data = await response.json().catch(() => null);
  const accessToken = String(data?.access_token || "").trim();
  if (!response.ok || !accessToken) {
    throw new Error("Keycloak token refresh failed.");
  }

  return {
    accessToken,
    refreshToken: String(data?.refresh_token || token).trim(),
    expiresInSeconds: expiresInFromTokenResponse(data, accessToken),
    refreshExpiresInSeconds: Number(data?.refresh_expires_in) > 0 ? Math.floor(Number(data.refresh_expires_in)) : undefined,
  };
}
