import { NextRequest } from "next/server";
import { getPool } from "@/config/db";

type TokenIdentity = {
  keycloakId: string;
  userName: string;
  email: string;
};

export type ResolvedAuthUser = {
  userId: number;
  roleId: number;
  userName: string;
  matchedBy: "KeycloakId" | "UserName" | "Email";
};

function decodeJwtPayload(token: string): any | null {
  try {
    const payloadPart = token.split(".")[1] || "";
    if (!payloadPart) return null;

    const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "="
    );

    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch (err) {
    console.error("[auth] Failed to decode JWT payload", err);
    return null;
  }
}

export function getTokenIdentityFromAccessToken(token: string): TokenIdentity | null {
  const decoded = decodeJwtPayload(token);
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

export function getTokenIdentityFromRequest(req: NextRequest): TokenIdentity | null {
  const cookieToken = req.cookies.get("access_token")?.value;
  const headerToken = req.headers.get("authorization")?.startsWith("Bearer ")
    ? req.headers.get("authorization")!.slice(7)
    : "";

  const token = cookieToken || headerToken;
  if (!token) {
    console.warn("[auth] No token found in access_token cookie or Authorization header");
    return null;
  }

  return getTokenIdentityFromAccessToken(token);
}

export async function resolveAuthUserFromAccessToken(
  token: string
): Promise<ResolvedAuthUser | null> {
  try {
    const identity = getTokenIdentityFromAccessToken(token);
    if (!identity) return null;

    const pool = await getPool();
    const [rows]: any = await pool.query(
      `SELECT UserId, UserName, RoleId,
              CASE
                WHEN KeycloakId = ? THEN 'KeycloakId'
                WHEN LOWER(UserName) = LOWER(?) THEN 'UserName'
                WHEN LOWER(Email) = LOWER(?) THEN 'Email'
                ELSE NULL
              END AS MatchedBy
       FROM Users
       WHERE
         (KeycloakId = ? AND ? <> '')
         OR (LOWER(UserName) = LOWER(?) AND ? <> '')
         OR (LOWER(Email) = LOWER(?) AND ? <> '')
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

    return {
      userId: Number(rows[0].UserId),
      userName: String(rows[0].UserName || identity.userName),
      roleId: Number(rows[0].RoleId),
      matchedBy: (rows[0].MatchedBy || "KeycloakId") as ResolvedAuthUser["matchedBy"],
    };
  } catch (err) {
    console.error("[auth] Auth resolution error", err);
    return null;
  }
}

export async function resolveAuthUser(req: NextRequest): Promise<ResolvedAuthUser | null> {
  const cookieToken = req.cookies.get("access_token")?.value;
  const headerToken = req.headers.get("authorization")?.startsWith("Bearer ")
    ? req.headers.get("authorization")!.slice(7)
    : "";

  const token = cookieToken || headerToken;
  if (!token) {
    console.warn("[auth] No token found in access_token cookie or Authorization header");
    return null;
  }

  return resolveAuthUserFromAccessToken(token);
}

// Async: decodes JWT, looks up user in DB, returns UserId + RoleId
export async function getAuthUser(req: NextRequest): Promise<{ userId: number; roleId: number } | null> {
  const resolved = await resolveAuthUser(req);
  if (!resolved) return null;
  return { userId: resolved.userId, roleId: resolved.roleId };
}
