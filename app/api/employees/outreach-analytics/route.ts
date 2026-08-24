import { NextRequest, NextResponse } from "next/server";
import { getPool } from "../../../../config/db";
import { getAuthUser } from "../../lib/auth";
import { buildLeadOwnerVisibilityClause } from "@/app/api/lib/lead-access";

export async function GET(req: NextRequest) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const pool = await getPool();
    const visibility = buildLeadOwnerVisibilityClause(authUser, "l");
    const entityType = req.nextUrl.searchParams.get("type") ?? "";

    const whereClauses: string[] = [];
    const params: (string | number)[] = [];

    if (entityType === "lead") {
      whereClauses.push("(l.AccountTypeId IS NULL OR at.Name NOT IN ('Prospect', 'Account'))");
    } else if (entityType === "prospect") {
      whereClauses.push("at.Name = 'Prospect'");
    } else if (entityType === "account") {
      whereClauses.push("at.Name = 'Account'");
    }

    whereClauses.push(visibility.clause);
    params.push(...visibility.params);

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const [rows]: any = await pool.query(
      `
      SELECT
        COALESCE(SUM(CASE WHEN lc.LinkedInRequestSent = 1 THEN 1 ELSE 0 END), 0) AS totalLinkedInRequestsSent,
        COALESCE(SUM(CASE WHEN lc.LinkedInRequestAccepted = 1 THEN 1 ELSE 0 END), 0) AS totalLinkedInRequestsAccepted,
        COALESCE(SUM(CASE WHEN lc.EmailSent = 1 THEN 1 ELSE 0 END), 0) AS totalEmailsSent
      FROM LeadContacts lc
      INNER JOIN Leads l ON l.LeadId = lc.LeadId
      LEFT JOIN AccountTypes at ON at.AccountTypeId = l.AccountTypeId
      ${whereClause}
      `,
      params
    );

    const totalLinkedInRequestsSent = Number(rows?.[0]?.totalLinkedInRequestsSent ?? 0);
    const totalLinkedInRequestsAccepted = Number(rows?.[0]?.totalLinkedInRequestsAccepted ?? 0);
    const totalEmailsSent = Number(rows?.[0]?.totalEmailsSent ?? 0);
    const acceptanceRate =
      totalLinkedInRequestsSent > 0
        ? Number(((totalLinkedInRequestsAccepted / totalLinkedInRequestsSent) * 100).toFixed(1))
        : 0;

    return NextResponse.json({
      totalLinkedInRequestsSent,
      totalLinkedInRequestsAccepted,
      totalEmailsSent,
      acceptanceRate,
    });
  } catch (error) {
    console.error("Error fetching outreach analytics:", error);
    return NextResponse.json(
      { error: "Failed to fetch outreach analytics" },
      { status: 500 }
    );
  }
}

