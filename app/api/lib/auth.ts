import { NextRequest } from "next/server";
import { createPublicKey, verify as verifySignature } from "node:crypto";
import { getPool } from "../../../config/db";
import {
  ACTIVE_COMPANY_COOKIE,
  loadCompanyMemberships,
  parseRequestedCompanyId,
  resolveActiveMembership,
} from "./company-tenancy";
import { getKeycloakClientId, getKeycloakIssuer, getKeycloakJwksUrl } from "./keycloak";

type TokenIdentity = {
  keycloakId: string;
  userName: string;
  email: string;
};

type VerifiedTokenPayload = {
  sub?: unknown;
  preferred_username?: unknown;
  username?: unknown;
  email?: unknown;
  iss?: unknown;
  aud?: unknown;
  azp?: unknown;
  exp?: unknown;
  iat?: unknown;
  nbf?: unknown;
};

type JwtHeader = {
  alg?: unknown;
  kid?: unknown;
  typ?: unknown;
};

export type ResolvedAuthUser = {
  userId: number;
  roleId: number;
  roleName?: string;
  userName: string;
  matchedBy: "KeycloakId" | "UserName" | "Email";
  companyId: number | null;
};

function base64UrlDecode(value: string): string {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function base64UrlToBuffer(value: string): Buffer {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64");
}

function parseJwtParts(token: string): { headerRaw: string; payloadRaw: string; signatureRaw: string } | null {
  const [headerRaw, payloadRaw, signatureRaw] = String(token || "").split(".");
  if (!headerRaw || !payloadRaw || !signatureRaw) return null;
  return { headerRaw, payloadRaw, signatureRaw };
}

function parseJwtHeader(token: string): JwtHeader | null {
  try {
    const parts = parseJwtParts(token);
    if (!parts) return null;
    return JSON.parse(base64UrlDecode(parts.headerRaw));
  } catch (err) {
    console.error("[auth] Failed to decode JWT header", err);
    return null;
  }
}

function parseJwtPayload(token: string): VerifiedTokenPayload | null {
  try {
    const parts = parseJwtParts(token);
    if (!parts) return null;
    return JSON.parse(base64UrlDecode(parts.payloadRaw));
  } catch (err) {
    console.error("[auth] Failed to decode JWT payload", err);
    return null;
  }
}

function getNowEpochSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function audMatchesClient(aud: unknown, clientId: string): boolean {
  if (typeof aud === "string") return aud === clientId;
  if (Array.isArray(aud)) return aud.some((item) => typeof item === "string" && item === clientId);
  return false;
}

function claimAsNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

type JwkResponse = {
  keys?: Array<Record<string, unknown>>;
};

const JWKS_TTL_MS = 10 * 60 * 1000;
let cachedJwks: { url: string; expiresAt: number; keys: Array<Record<string, unknown>> } | null = null;
let testPoolFactory: (() => Promise<any>) | null = null;
let testAuthUserFactory: (() => Promise<ResolvedAuthUser | null> | ResolvedAuthUser | null) | null = null;

async function fetchJwks(jwksUrl: string): Promise<Array<Record<string, unknown>>> {
  const now = Date.now();
  if (cachedJwks && cachedJwks.url === jwksUrl && cachedJwks.expiresAt > now) {
    return cachedJwks.keys;
  }

  const response = await fetch(jwksUrl, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("KEYCLOAK_JWKS_FETCH_FAILED");
  }

  const body = (await response.json().catch(() => null)) as JwkResponse | null;
  const keys = Array.isArray(body?.keys) ? body!.keys : [];
  if (!keys.length) {
    throw new Error("KEYCLOAK_JWKS_EMPTY");
  }

  cachedJwks = {
    url: jwksUrl,
    keys,
    expiresAt: now + JWKS_TTL_MS,
  };

  return keys;
}

export function __resetAuthJwksCacheForTests(): void {
  cachedJwks = null;
}

export function __setAuthTestPoolFactoryForTests(factory: (() => Promise<any>) | null): void {
  testPoolFactory = factory;
}

export function __setAuthUserForTests(
  factory: (() => Promise<ResolvedAuthUser | null> | ResolvedAuthUser | null) | null
): void {
  testAuthUserFactory = factory;
}

function findSigningKey(keys: Array<Record<string, unknown>>, kid: string): Record<string, unknown> | null {
  return (
    keys.find((key) => {
      const keyKid = String(key?.kid || "").trim();
      const use = String(key?.use || "").trim().toLowerCase();
      const kty = String(key?.kty || "").trim().toUpperCase();
      return keyKid === kid && (use === "" || use === "sig") && kty === "RSA";
    }) || null
  );
}

async function verifyKeycloakAccessToken(token: string): Promise<VerifiedTokenPayload | null> {
  try {
    const issuer = getKeycloakIssuer();
    const clientId = getKeycloakClientId();
    const jwksUrl = getKeycloakJwksUrl();

    if (!issuer || !clientId || !jwksUrl) {
      console.error("[auth] Missing Keycloak configuration for JWT verification");
      return null;
    }

    const header = parseJwtHeader(token);
    const payload = parseJwtPayload(token);
    const parts = parseJwtParts(token);
    if (!header || !payload || !parts) {
      return null;
    }

    const alg = String(header.alg || "").trim();
    const kid = String(header.kid || "").trim();
    if (alg !== "RS256" || !kid) {
      return null;
    }

    const keys = await fetchJwks(jwksUrl);
    const jwk = findSigningKey(keys, kid);
    if (!jwk) {
      return null;
    }

    const verifier = createPublicKey({ key: jwk as any, format: "jwk" });
    const signedData = `${parts.headerRaw}.${parts.payloadRaw}`;
    const signature = base64UrlToBuffer(parts.signatureRaw);

    const validSignature = verifySignature("RSA-SHA256", Buffer.from(signedData), verifier, signature);
    if (!validSignature) {
      return null;
    }

    const tokenIssuer = String(payload.iss || "").trim();
    if (!tokenIssuer || tokenIssuer !== issuer) {
      return null;
    }

    const now = getNowEpochSeconds();
    const exp = claimAsNumber(payload.exp);
    if (!exp || exp <= now) {
      return null;
    }

    const nbf = claimAsNumber(payload.nbf);
    if (nbf && nbf > now) {
      return null;
    }

    const iat = claimAsNumber(payload.iat);
    if (iat && iat > now + 60) {
      return null;
    }

    const audienceOk = audMatchesClient(payload.aud, clientId) || String(payload.azp || "").trim() === clientId;
    if (!audienceOk) {
      return null;
    }

    return payload;
  } catch (err) {
    console.error("[auth] Access token verification failed", err);
    return null;
  }
}

export async function getTokenIdentityFromAccessToken(token: string): Promise<TokenIdentity | null> {
  const decoded = await verifyKeycloakAccessToken(token);
  if (!decoded) return null;

  const keycloakId = String(decoded?.sub || "").trim();
  const userName = String(
    decoded?.preferred_username || decoded?.username || ""
  ).trim();
  const email = String(decoded?.email || "").trim();

  if (!keycloakId && !userName && !email) {
    console.warn("[auth] Token decoded but identity claims missing", {
      hasSub: Boolean(decoded?.sub),
      hasPreferredUsername: Boolean(decoded?.preferred_username),
      hasEmail: Boolean(decoded?.email),
    });
    return null;
  }

  return { keycloakId, userName, email };
}

export function extractAccessTokenFromRequest(req: NextRequest): string {
  const cookieToken = req.cookies.get("access_token")?.value;
  const headerToken = req.headers.get("authorization")?.startsWith("Bearer ")
    ? req.headers.get("authorization")!.slice(7)
    : "";

  return String(cookieToken || headerToken || "").trim();
}

export async function getTokenIdentityFromRequest(req: NextRequest): Promise<TokenIdentity | null> {
  const token = extractAccessTokenFromRequest(req);

  if (!token) {
    console.warn("[auth] No token found in access_token cookie or Authorization header");
    return null;
  }

  return getTokenIdentityFromAccessToken(token);
}

export async function resolveAuthUserFromAccessToken(
  token: string,
  options?: { requestedCompanyId?: number | null }
): Promise<ResolvedAuthUser | null> {
  try {
    const identity = await getTokenIdentityFromAccessToken(token);
    if (!identity) return null;

    const pool = testPoolFactory ? await testPoolFactory() : await getPool();
    const [rows]: any = await pool.query(
      `SELECT u.UserId, u.UserName, u.RoleId, r.RoleName,
              CASE
                WHEN u.KeycloakId = ? THEN 'KeycloakId'
                WHEN LOWER(u.UserName) = LOWER(?) THEN 'UserName'
                WHEN LOWER(u.Email) = LOWER(?) THEN 'Email'
                ELSE NULL
              END AS MatchedBy
       FROM Users u
       LEFT JOIN Roles r ON r.RoleId = u.RoleId
       WHERE
         (u.KeycloakId = ? AND ? <> '')
         OR (LOWER(u.UserName) = LOWER(?) AND ? <> '')
         OR (LOWER(u.Email) = LOWER(?) AND ? <> '')
       LIMIT 1`,
      [
        identity.keycloakId,
        identity.userName,
        identity.email,
        identity.keycloakId,
        identity.keycloakId,
        identity.userName,
        identity.userName,
        identity.email,
        identity.email,
      ]
    );

    if (!rows || rows.length === 0) {
      console.warn("[auth] User not mapped in ACARSH Users table", {
        keycloakId: identity.keycloakId || null,
        userName: identity.userName || null,
        email: identity.email || null,
      });
      return null;
    }

    const userId = Number(rows[0].UserId);
    const legacyRoleId = Number(rows[0].RoleId);
    let companyId: number | null = null;
    let roleId = legacyRoleId;
    try {
      const membership = resolveActiveMembership(
        await loadCompanyMemberships(pool, userId),
        options?.requestedCompanyId
      );
      if (membership) {
        companyId = membership.companyId;
        roleId = membership.roleId;
      }
    } catch (err) {
      console.warn("[auth] Company membership lookup skipped", err);
    }

    return {
      userId,
      userName: String(rows[0].UserName || identity.userName),
      roleId,
      roleName: String(rows[0].RoleName || "").trim() || undefined,
      matchedBy: (rows[0].MatchedBy || "KeycloakId") as ResolvedAuthUser["matchedBy"],
      companyId,
    };
  } catch (err) {
    console.error("[auth] Auth resolution error", err);
    return null;
  }
}

export async function resolveAuthUser(req: NextRequest): Promise<ResolvedAuthUser | null> {
  if (testAuthUserFactory) {
    return await testAuthUserFactory();
  }
  const token = extractAccessTokenFromRequest(req);
  if (!token) {
    console.warn("[auth] No token found in access_token cookie or Authorization header");
    return null;
  }

  return resolveAuthUserFromAccessToken(token, {
    requestedCompanyId: parseRequestedCompanyId(req.cookies.get(ACTIVE_COMPANY_COOKIE)?.value),
  });
}

// Async: decodes JWT, looks up user in DB, returns UserId + RoleId
export async function getAuthUser(
  req: NextRequest
): Promise<{ userId: number; roleId: number; companyId: number | null } | null> {
  const resolved = await resolveAuthUser(req);
  if (!resolved) return null;
  return { userId: resolved.userId, roleId: resolved.roleId, companyId: resolved.companyId };
}
