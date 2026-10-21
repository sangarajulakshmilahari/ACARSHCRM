import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import { getAuthUser } from "@/app/api/lib/auth";
import {
  buildLeadOwnerVisibilityClause,
  hasGlobalLeadAccess,
} from "@/app/api/lib/lead-access";

export async function GET(req: NextRequest) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const search = String(req.nextUrl.searchParams.get("search") || "").trim();
    const limit = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get("limit") || 200)));

    const pool = await getPool();
    const hasGlobalAccess = hasGlobalLeadAccess(authUser.roleId);
    const visibility = buildLeadOwnerVisibilityClause(authUser, "l");

    const whereClauses: string[] = ["1=1"];
    const params: Array<number | string> = [];

    if (search) {
      whereClauses.push(
        `(COALESCE(lc.ContactName, '') LIKE ? OR COALESCE(lc.ContactEmail, '') LIKE ? OR COALESCE(l.CompanyName, '') LIKE ?)`
      );
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    if (!hasGlobalAccess) {
      whereClauses.push(visibility.clause);
      params.push(...visibility.params);
    }

    const [rows]: any = await pool.query(
      `
        SELECT
          lc.LeadContactID,
          lc.LeadId,
          lc.ContactName,
          lc.ContactEmail,
          lc.ContactTitle,
          l.CompanyName,
          u.UserName AS OwnerName,
          at.Name AS AccountTypeName
        FROM leadcontacts lc
        INNER JOIN leads l ON l.LeadId = lc.LeadId
        LEFT JOIN users u ON u.UserId = l.OwnerId
        LEFT JOIN accounttypes at ON at.AccountTypeId = l.AccountTypeId
        WHERE ${whereClauses.join(" AND ")}
          AND COALESCE(lc.ContactEmail, '') <> ''
        ORDER BY l.CreatedOn DESC, lc.LeadContactID DESC
        LIMIT ?
      `,
      [...params, limit]
    );

    return NextResponse.json(Array.isArray(rows) ? rows : []);
  } catch (error) {
    console.error("[email-sequence-contacts-search] GET error", error);
    return NextResponse.json({ error: "Failed to fetch sequence contacts" }, { status: 500 });
  }
}

