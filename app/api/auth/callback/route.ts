import { keycloak } from "../../lib/keycloak";
import { resolveAuthUserFromAccessToken } from "@/app/api/lib/auth";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");

  if (!code) {
    return new Response("No authorization code", { status: 400 });
  }

  // Exchange code for token
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
    let keycloakId: string | null = null;
    try {
      const payloadPart = accessToken.split(".")[1] || "";
      const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized.padEnd(
        normalized.length + ((4 - (normalized.length % 4)) % 4),
        "="
      );
      const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
      keycloakId = String(payload?.sub || "") || null;
    } catch {
      // keep null; logging handled below
    }

    console.warn("[auth/callback] Keycloak user not found in ACARSH Users table", {
      keycloakId,
    });

    return new Response(null, {
      status: 302,
      headers: {
        Location: "/access_denied",
      },
    });
  }

  console.info("[auth/callback] ACARSH user resolved", {
    userId: resolved.userId,
    roleId: resolved.roleId,
    matchedBy: resolved.matchedBy,
  });

  const isProd = process.env.NODE_ENV === "production";
  const cookieParts = [
    `access_token=${accessToken}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    isProd ? "Secure" : "",
  ].filter(Boolean);

  //  Set token in HTTP-only cookie
  return new Response(null, {
    status: 302,
    headers: {
      "Set-Cookie": cookieParts.join("; "),
      Location: "/webpage",
    },
  });
}

