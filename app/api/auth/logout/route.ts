import { NextResponse } from "next/server";

function getAppOrigin() {
  const redirectUrl = String(process.env.KEYCLOAK_REDIRECT_URL || "").trim();
  try {
    if (redirectUrl) return new URL(redirectUrl).origin;
  } catch {
    // fall through
  }
  return "https://localhost:3001";
}

export async function GET() {
  const keycloakLogoutUrl =
    `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}` +
    `/protocol/openid-connect/logout` +
    `?client_id=${process.env.KEYCLOAK_CLIENT_ID}` +
    `&post_logout_redirect_uri=${encodeURIComponent(
      `${getAppOrigin()}/api/auth/login`
    )}`;

    console.log(process.env.KEYCLOAK_URL);


  const res = NextResponse.redirect(keycloakLogoutUrl);

  // Clear our app cookie
  res.cookies.set("access_token", "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  res.cookies.set("refresh_token", "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  res.cookies.set("acarsh_active_company_id", "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });

  // Clear Microsoft Graph delegated-session cookies (Phase 5A)
  res.cookies.set("graph_access_token", "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  res.cookies.set("graph_refresh_token", "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  res.cookies.set("graph_expires_at", "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  res.cookies.set("graph_user_principal", "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  res.cookies.set("graph_oauth_state", "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });

  return res;
}
