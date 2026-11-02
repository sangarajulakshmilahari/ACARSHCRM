import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { NextResponse } from "next/server";

import {
  KEYCLOAK_ACCESS_COOKIE,
  KEYCLOAK_REFRESH_COOKIE,
  accessTokenNeedsRefresh,
  applyKeycloakSessionCookies,
  clearKeycloakSessionCookies,
  expiresInFromTokenResponse,
  readJwtExpEpoch,
  refreshKeycloakTokens,
} from "./keycloak-session";

const originalFetch = globalThis.fetch;
const originalEnv = {
  KEYCLOAK_URL: process.env.KEYCLOAK_URL,
  KEYCLOAK_REALM: process.env.KEYCLOAK_REALM,
  KEYCLOAK_CLIENT_ID: process.env.KEYCLOAK_CLIENT_ID,
  KEYCLOAK_CLIENT_SECRET: process.env.KEYCLOAK_CLIENT_SECRET,
};

function unsignedJwt(payload: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env.KEYCLOAK_URL = originalEnv.KEYCLOAK_URL;
  process.env.KEYCLOAK_REALM = originalEnv.KEYCLOAK_REALM;
  process.env.KEYCLOAK_CLIENT_ID = originalEnv.KEYCLOAK_CLIENT_ID;
  process.env.KEYCLOAK_CLIENT_SECRET = originalEnv.KEYCLOAK_CLIENT_SECRET;
});

test("access tokens refresh before JWT expiry and ignore unsigned payloads without exp", () => {
  const now = 1_700_000_000;
  assert.equal(accessTokenNeedsRefresh("", now), true);
  assert.equal(accessTokenNeedsRefresh(unsignedJwt({ exp: now + 30 }), now), true);
  assert.equal(accessTokenNeedsRefresh(unsignedJwt({ exp: now + 91 }), now), false);
  assert.equal(readJwtExpEpoch("not-a-jwt"), null);
  assert.equal(expiresInFromTokenResponse({ expires_in: 300 }, ""), 300);
});

test("session cookies store refresh tokens and clear both cookies", () => {
  const response = NextResponse.json({ ok: true });
  applyKeycloakSessionCookies(response, {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    expiresInSeconds: 300,
    refreshExpiresInSeconds: 1800,
  });
  assert.equal(response.cookies.get(KEYCLOAK_ACCESS_COOKIE)?.value, "access-1");
  assert.equal(response.cookies.get(KEYCLOAK_REFRESH_COOKIE)?.value, "refresh-1");
  clearKeycloakSessionCookies(response);
  assert.equal(response.cookies.get(KEYCLOAK_ACCESS_COOKIE)?.value, "");
  assert.equal(response.cookies.get(KEYCLOAK_REFRESH_COOKIE)?.value, "");
});

test("refresh token exchange keeps rotated refresh tokens and exact access token", async () => {
  process.env.KEYCLOAK_URL = "https://kc.example.com";
  process.env.KEYCLOAK_REALM = "acarsh";
  process.env.KEYCLOAK_CLIENT_ID = "acarsh-client";
  process.env.KEYCLOAK_CLIENT_SECRET = "secret";
  const calls: Array<{ url: string; body: string }> = [];
  globalThis.fetch = (async (input: any, init?: any) => {
    calls.push({ url: String(input), body: String(init?.body || "") });
    return {
      ok: true,
      json: async () => ({
        access_token: "next-access",
        refresh_token: "next-refresh",
        expires_in: 300,
        refresh_expires_in: 1800,
      }),
    } as any;
  }) as typeof fetch;

  const tokens = await refreshKeycloakTokens("old-refresh");
  assert.equal(tokens.accessToken, "next-access");
  assert.equal(tokens.refreshToken, "next-refresh");
  assert.equal(tokens.expiresInSeconds, 300);
  assert.match(calls[0]?.url || "", /\/token$/);
  assert.match(calls[0]?.body || "", /grant_type=refresh_token/);
  assert.equal(calls[0]?.body.includes("old-refresh"), true);
});
