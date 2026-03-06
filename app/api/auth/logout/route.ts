import { NextResponse } from "next/server";

export async function GET() {
  const keycloakLogoutUrl =
    `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}` +
    `/protocol/openid-connect/logout` +
    `?client_id=${process.env.KEYCLOAK_CLIENT_ID}` +
    `&post_logout_redirect_uri=${encodeURIComponent(
<<<<<<< HEAD
      "http://localhost:3000/api/auth/login"
=======
      "http://acarsh.adroitent.ai/api/auth/login"
>>>>>>> 1356f272e316d4b9198119a5be47e097b59c843b
    )}`;

  const res = NextResponse.redirect(keycloakLogoutUrl);

  // Clear our app cookie
  res.cookies.set("access_token", "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });

  return res;
}
