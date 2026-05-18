import { NextRequest } from "next/server";
import { getPool } from "@/config/db";

// Async: decodes JWT, looks up user in DB by KeycloakId, returns UserId + RoleId
export async function getAuthUser(req: NextRequest): Promise<{ userId: number; roleId: number } | null> {
  try {
    const token = req.cookies.get("access_token")?.value;
    if (!token) return null;

    const decoded: any = JSON.parse(atob(token.split(".")[1]));
    const keycloakId: string | undefined = decoded.sub;
    if (!keycloakId) return null;

    const pool = await getPool();
    const [rows]: any = await pool.query(
      `SELECT UserId, RoleId FROM Users WHERE KeycloakId = ? LIMIT 1`,
      [keycloakId]
    );

    if (!rows || rows.length === 0) return null;
    return { userId: rows[0].UserId, roleId: rows[0].RoleId };
  } catch (err) {
    console.error("Auth error:", err);
    return null;
  }
}
