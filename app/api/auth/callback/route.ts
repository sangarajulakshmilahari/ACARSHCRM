import { keycloak } from "../../lib/keycloak";
<<<<<<< HEAD
import { getPool } from "@/config/db";
=======
>>>>>>> 1356f272e316d4b9198119a5be47e097b59c843b

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
      redirect_uri: process.env.KEYCLOAK_REDIRECT_URI!,
      code,
    }),
  });

  const tokenData = await tokenResponse.json();

  if (!tokenResponse.ok) {
    console.error("Token error:", tokenData);
    return new Response("Token exchange failed", { status: 401 });
  }

<<<<<<< HEAD
  // Decode access token to extract username/email
  let usernameOrEmail: string | null = null;
  try {
    const parts = (tokenData.access_token || "").split(".");
    if (parts.length >= 2) {
      const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
      usernameOrEmail = payload.preferred_username || payload.email || null;
    }
  } catch (err) {
    console.error("Failed to decode token payload", err);
  }

  if (!usernameOrEmail) {
    return new Response("Unable to determine user from token", { status: 401 });
  }

  // Verify the user exists in local DB (Users table)
  try {
    const pool = await getPool();
    const conn = await pool.getConnection();
    try {
      const [rows]: any = await conn.query(
        `SELECT UserId, UserName, Email, IsActive FROM Users WHERE UserName = ? OR Email = ? LIMIT 1`,
        [usernameOrEmail, usernameOrEmail]
      );

      if (!rows || !rows.length) {
        // User exists in Keycloak but not in local DB -> deny
        return new Response("Unauthorized", { status: 403 });
      }

      const user = rows[0];
      if (user.IsActive === 0) {
        return new Response("User is inactive", { status: 403 });
      }

      // Set token cookie and optional user info cookie
      const cookieOptions = [`access_token=${tokenData.access_token}; HttpOnly; Path=/; SameSite=Lax`];
      // Add a non-HttpOnly cookie with username for client UI if desired
      cookieOptions.push(`user=${encodeURIComponent(user.UserName)}; Path=/; SameSite=Lax`);

      return new Response(null, {
        status: 302,
        headers: {
          "Set-Cookie": cookieOptions.join("; "),
          Location: "/webpage",
        },
      });
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error("DB verification error:", err);
    return new Response("Server error", { status: 500 });
  }
=======
  //  Set token in HTTP-only cookie
  return new Response(null, {
    status: 302,
    headers: {
      "Set-Cookie": `access_token=${tokenData.access_token}; HttpOnly; Path=/; SameSite=Lax`,
      Location: "/webpage",
    },
  });
>>>>>>> 1356f272e316d4b9198119a5be47e097b59c843b
}
