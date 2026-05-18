import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get("access_token")?.value;

    if (!token) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const decoded: any = JSON.parse(atob(token.split(".")[1]));

    // `sub` is the Keycloak user UUID — matches KeycloakId column in Users table
    const keycloakId: string | undefined = decoded.sub;

    if (!keycloakId) {
      return NextResponse.json({ error: "No Keycloak ID in token" }, { status: 400 });
    }

    const pool = await getPool();
    const [rows]: any = await pool.query(
      `SELECT UserId, UserName, RoleId FROM Users WHERE KeycloakId = ? LIMIT 1`,
      [keycloakId]
    );

    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({
      name: rows[0].UserName,
      userId: rows[0].UserId,
      roleId: rows[0].RoleId,
    });
  } catch (err) {
    console.error("Error in /api/auth/me:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
