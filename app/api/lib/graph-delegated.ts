import { timingSafeEqual, randomUUID } from "crypto";
import { NextRequest } from "next/server";

const GRAPH_SCOPE = "openid profile offline_access User.Read Mail.Send";
export const GRAPH_ENGAGE_TABS = ["emailTemplates", "emailSequences", "emailHistory"] as const;
export type GraphEngageTab = (typeof GRAPH_ENGAGE_TABS)[number];

const COOKIE_NAMES = {
  accessToken: "graph_access_token",
  refreshToken: "graph_refresh_token",
  expiresAt: "graph_expires_at",
  principal: "graph_user_principal",
  oauthState: "graph_oauth_state",
};

type AzureAuthConfig = {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  redirectUri: string;
};

export type GraphDelegatedSession = {
  accessToken: string;
  principal: string | null;
  expiresAtEpochSeconds: number;
  setCookieHeaders: string[];
};

export class GraphDelegatedAuthError extends Error {
  status: number;
  code: string;
  safeMessage: string;

  constructor(status: number, code: string, safeMessage: string) {
    super(safeMessage);
    this.status = status;
    this.code = code;
    this.safeMessage = safeMessage;
  }
}

function trim(value: unknown): string {
  return String(value ?? "").trim();
}

export function getAzureAuthConfig(): AzureAuthConfig {
  const clientId =
    trim(process.env.AZURE_AD_CLIENT_ID) || trim(process.env.AZURE_CLIENT_ID);
  const clientSecret =
    trim(process.env.AZURE_AD_CLIENT_SECRET) ||
    trim(process.env.AZURE_CLIENT_SECRET);
  const tenantId =
    trim(process.env.AZURE_AD_TENANT_ID) || trim(process.env.AZURE_TENANT_ID);
  const redirectUri =
    trim(process.env.AZURE_AD_REDIRECT_URI) ||
    "https://localhost:3001/api/auth/callback/azure-ad";

  if (!clientId || !clientSecret || !tenantId) {
    throw new GraphDelegatedAuthError(
      500,
      "AZURE_CONFIG_MISSING",
      "Microsoft Graph configuration is incomplete"
    );
  }

  return { clientId, clientSecret, tenantId, redirectUri };
}

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
  } catch {
    return null;
  }
}

function parsePrincipalFromAccessToken(accessToken: string): string | null {
  const payload = decodeJwtPayload(accessToken);
  const principal =
    trim(payload?.preferred_username) || trim(payload?.upn) || trim(payload?.email);
  return principal || null;
}

function parseEpoch(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isDelegatedAccessTokenUsable(
  accessToken: string,
  expiresAtEpochSeconds: number,
  nowEpochSeconds = Math.floor(Date.now() / 1000)
): boolean {
  if (!accessToken || !expiresAtEpochSeconds) return false;
  return expiresAtEpochSeconds - nowEpochSeconds > 90;
}

function isTokenUsable(accessToken: string, expiresAtEpochSeconds: number): boolean {
  return isDelegatedAccessTokenUsable(accessToken, expiresAtEpochSeconds);
}

export function normalizeEngageTab(value: unknown): GraphEngageTab {
  const tab = String(value || "").trim();
  if ((GRAPH_ENGAGE_TABS as readonly string[]).includes(tab)) {
    return tab as GraphEngageTab;
  }
  return "emailTemplates";
}

export function createGraphOAuthState(tab?: unknown): string {
  return `${randomUUID()}:${normalizeEngageTab(tab)}`;
}

function statesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function validateGraphOAuthState(cookieState: string, queryState: string): {
  ok: boolean;
  reason?: string;
  tab: GraphEngageTab;
} {
  const cookie = trim(cookieState);
  const query = trim(queryState);
  if (!cookie || !query) {
    return { ok: false, reason: "invalid_state", tab: "emailTemplates" };
  }
  if (!statesEqual(cookie, query)) {
    return { ok: false, reason: "invalid_state", tab: "emailTemplates" };
  }
  const separator = cookie.lastIndexOf(":");
  const tab = separator >= 0 ? cookie.slice(separator + 1) : "emailTemplates";
  return { ok: true, tab: normalizeEngageTab(tab) };
}

export function mapMicrosoftOAuthQueryError(errorCode: unknown): string | null {
  const code = trim(errorCode);
  if (!code) return null;
  if (code === "access_denied") return "access_denied";
  if (code === "invalid_request") return "invalid_request";
  return "oauth_error";
}

export function selectMailboxIdentityFromGraphProfile(profile: {
  mail?: unknown;
  userPrincipalName?: unknown;
  displayName?: unknown;
}): { mailbox: string | null; displayName: string | null } {
  const mailbox =
    trim(profile?.mail) ||
    trim(profile?.userPrincipalName) ||
    null;
  const displayName = trim(profile?.displayName) || null;
  return { mailbox, displayName };
}

export function buildGraphPostAuthUrl(args: {
  origin: string;
  tab?: unknown;
  params?: Record<string, string>;
}): URL {
  const target = new URL("/webpage", args.origin || "https://localhost:3001");
  target.searchParams.set("tab", normalizeEngageTab(args.tab));
  Object.entries(args.params || {}).forEach(([key, value]) => {
    if (value) target.searchParams.set(key, value);
  });
  return target;
}

export async function fetchGraphMailboxIdentity(accessToken: string): Promise<{
  mailbox: string | null;
  displayName: string | null;
}> {
  const token = trim(accessToken);
  if (!token) {
    throw new GraphDelegatedAuthError(401, "GRAPH_TOKEN_MISSING", "Microsoft authorization token unavailable");
  }

  const response = await fetch(
    "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName",
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    }
  );

  if (response.status === 401) {
    throw new GraphDelegatedAuthError(
      401,
      "GRAPH_TOKEN_INVALID",
      "Microsoft authorization expired. Reconnect Microsoft account."
    );
  }

  if (!response.ok) {
    throw new GraphDelegatedAuthError(
      502,
      "GRAPH_MAILBOX_LOOKUP_FAILED",
      "Unable to read Microsoft mailbox identity"
    );
  }

  const payload = await response.json().catch(() => ({}));
  return selectMailboxIdentityFromGraphProfile(payload);
}

function buildCookieHeader(
  name: string,
  value: string,
  options?: { maxAge?: number; expires?: string }
): string {
  const isProd = process.env.NODE_ENV === "production";
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];

  if (isProd) parts.push("Secure");
  if (typeof options?.maxAge === "number") parts.push(`Max-Age=${options.maxAge}`);
  if (options?.expires) parts.push(`Expires=${options.expires}`);
  return parts.join("; ");
}

export function buildOAuthStateCookie(state: string): string {
  return buildCookieHeader(COOKIE_NAMES.oauthState, state, { maxAge: 600 });
}

export function buildOAuthStateClearCookie(): string {
  return buildCookieHeader(COOKIE_NAMES.oauthState, "", {
    maxAge: 0,
    expires: new Date(0).toUTCString(),
  });
}

function buildTokenCookies(payload: {
  accessToken: string;
  refreshToken: string;
  expiresAtEpochSeconds: number;
  principal: string | null;
}): string[] {
  const refreshMaxAge = 60 * 60 * 24 * 14;
  const principal = payload.principal || "";
  return [
    buildCookieHeader(COOKIE_NAMES.accessToken, payload.accessToken, {
      maxAge: 60 * 60,
    }),
    buildCookieHeader(COOKIE_NAMES.refreshToken, payload.refreshToken, {
      maxAge: refreshMaxAge,
    }),
    buildCookieHeader(COOKIE_NAMES.expiresAt, String(payload.expiresAtEpochSeconds), {
      maxAge: refreshMaxAge,
    }),
    buildCookieHeader(COOKIE_NAMES.principal, principal, {
      maxAge: refreshMaxAge,
    }),
  ];
}

export function buildGraphSessionClearCookies(): string[] {
  const expiredAt = new Date(0).toUTCString();
  return [
    buildCookieHeader(COOKIE_NAMES.accessToken, "", { maxAge: 0, expires: expiredAt }),
    buildCookieHeader(COOKIE_NAMES.refreshToken, "", { maxAge: 0, expires: expiredAt }),
    buildCookieHeader(COOKIE_NAMES.expiresAt, "", { maxAge: 0, expires: expiredAt }),
    buildCookieHeader(COOKIE_NAMES.principal, "", { maxAge: 0, expires: expiredAt }),
    buildOAuthStateClearCookie(),
  ];
}

export function getOAuthStateFromRequest(req: NextRequest): string {
  return trim(req.cookies.get(COOKIE_NAMES.oauthState)?.value);
}

async function refreshDelegatedToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAtEpochSeconds: number;
  principal: string | null;
}> {
  const config = getAzureAuthConfig();
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(
    config.tenantId
  )}/oauth2/v2.0/token`;

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      scope: GRAPH_SCOPE,
    }),
    cache: "no-store",
  });

  const tokenData: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    const providerError = trim(tokenData?.error) || "token_refresh_failed";
    console.error("[graph-delegated] Refresh token exchange failed", {
      status: response.status,
      providerError,
    });
    throw new GraphDelegatedAuthError(
      401,
      "GRAPH_TOKEN_REFRESH_FAILED",
      "Microsoft authorization expired. Reconnect Microsoft account."
    );
  }

  const nextAccessToken = trim(tokenData?.access_token);
  const nextRefreshToken = trim(tokenData?.refresh_token) || refreshToken;
  const expiresInSeconds = Number(tokenData?.expires_in || 3600);
  const expiresAtEpochSeconds = Math.floor(Date.now() / 1000) + expiresInSeconds;

  if (!nextAccessToken) {
    throw new GraphDelegatedAuthError(
      401,
      "GRAPH_TOKEN_MISSING",
      "Microsoft authorization token unavailable"
    );
  }

  return {
    accessToken: nextAccessToken,
    refreshToken: nextRefreshToken,
    expiresAtEpochSeconds,
    principal: parsePrincipalFromAccessToken(nextAccessToken),
  };
}

export async function getDelegatedGraphSession(
  req: NextRequest
): Promise<GraphDelegatedSession> {
  const accessToken = trim(req.cookies.get(COOKIE_NAMES.accessToken)?.value);
  const refreshToken = trim(req.cookies.get(COOKIE_NAMES.refreshToken)?.value);
  const expiresAtEpochSeconds = parseEpoch(
    trim(req.cookies.get(COOKIE_NAMES.expiresAt)?.value)
  );
  const principalCookie = trim(req.cookies.get(COOKIE_NAMES.principal)?.value) || null;

  if (isTokenUsable(accessToken, expiresAtEpochSeconds)) {
    return {
      accessToken,
      principal: principalCookie || parsePrincipalFromAccessToken(accessToken),
      expiresAtEpochSeconds,
      setCookieHeaders: [],
    };
  }

  if (!refreshToken) {
    throw new GraphDelegatedAuthError(
      401,
      "GRAPH_NOT_CONNECTED",
      "Microsoft account is not connected"
    );
  }

  const refreshed = await refreshDelegatedToken(refreshToken);

  return {
    accessToken: refreshed.accessToken,
    principal: refreshed.principal,
    expiresAtEpochSeconds: refreshed.expiresAtEpochSeconds,
    setCookieHeaders: buildTokenCookies(refreshed),
  };
}

export function getGraphSessionSnapshot(req: NextRequest): {
  connected: boolean;
  principal: string | null;
  expiresAtEpochSeconds: number;
} {
  const accessToken = trim(req.cookies.get(COOKIE_NAMES.accessToken)?.value);
  const expiresAtEpochSeconds = parseEpoch(
    trim(req.cookies.get(COOKIE_NAMES.expiresAt)?.value)
  );
  const principal = trim(req.cookies.get(COOKIE_NAMES.principal)?.value) || null;

  return {
    connected: isTokenUsable(accessToken, expiresAtEpochSeconds),
    principal,
    expiresAtEpochSeconds,
  };
}

export function getGraphOAuthConfigForAuthorize() {
  const config = getAzureAuthConfig();
  return {
    ...config,
    scope: GRAPH_SCOPE,
    authorizeUrl: `https://login.microsoftonline.com/${encodeURIComponent(
      config.tenantId
    )}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${encodeURIComponent(
      config.tenantId
    )}/oauth2/v2.0/token`,
  };
}

export async function exchangeAuthorizationCodeForGraphTokens(args: {
  code: string;
}): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAtEpochSeconds: number;
  principal: string | null;
}> {
  const { code } = args;
  const config = getGraphOAuthConfigForAuthorize();

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      code,
      scope: config.scope,
    }),
    cache: "no-store",
  });

  const tokenData: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    const providerError = trim(tokenData?.error) || "code_exchange_failed";
    console.error("[graph-delegated] Authorization code exchange failed", {
      status: response.status,
      providerError,
    });
    throw new GraphDelegatedAuthError(
      401,
      "GRAPH_CODE_EXCHANGE_FAILED",
      "Unable to connect Microsoft account"
    );
  }

  const accessToken = trim(tokenData?.access_token);
  const refreshToken = trim(tokenData?.refresh_token);
  const expiresInSeconds = Number(tokenData?.expires_in || 3600);
  const expiresAtEpochSeconds = Math.floor(Date.now() / 1000) + expiresInSeconds;

  if (!accessToken || !refreshToken) {
    throw new GraphDelegatedAuthError(
      401,
      "GRAPH_TOKENS_MISSING",
      "Microsoft token response is incomplete"
    );
  }

  return {
    accessToken,
    refreshToken,
    expiresAtEpochSeconds,
    principal: parsePrincipalFromAccessToken(accessToken),
  };
}

export function buildGraphTokenCookies(args: {
  accessToken: string;
  refreshToken: string;
  expiresAtEpochSeconds: number;
  principal: string | null;
}): string[] {
  return buildTokenCookies(args);
}

