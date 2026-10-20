import { NextResponse } from "next/server";

export async function GET() {
  const keycloakLogoutUrl =
    `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}` +
    `/protocol/openid-connect/logout` +
    `?client_id=${process.env.KEYCLOAK_CLIENT_ID}` +
    `&post_logout_redirect_uri=${encodeURIComponent(
      "http://localhost:3001/api/auth/login"
    )}`;

    console.log(process.env.KEYCLOAK_URL);


  const res = NextResponse.redirect(keycloakLogoutUrl);

  // Clear our app cookie
  res.cookies.set("access_token", "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  res.cookies.set("acarsh_active_company_id", "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });

  return res;
}
