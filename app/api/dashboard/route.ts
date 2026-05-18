import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import { getAuthUser } from "../lib/auth";

export async function GET(req: NextRequest) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const pool = await getPool();
    const isAdmin = authUser.roleId === 1;
    const scopedParams = isAdmin ? [] : [authUser.userId];

    //  1 Total Leads
    const [totalRows]: any = await pool.query(`
      SELECT COUNT(LeadId) AS totalLeads
      FROM Leads
      ${isAdmin ? "" : "WHERE OwnerId = ?"}
    `, scopedParams);

    //  Latest Activity per Lead
    const latestActivityCTE = `
      WITH LatestActivity AS (
        SELECT
          la.LeadId,
          la.StatusId,
          ROW_NUMBER() OVER (
            PARTITION BY la.LeadId
            ORDER BY la.ActivityDate DESC, la.CreatedOn DESC
          ) AS rn
        FROM LeadActivities la
      )
    `;

    //  2 Status-wise Counts
    const [statusCounts]: any = await pool.query(`
      ${latestActivityCTE}
      SELECT
        COALESCE(la.StatusId, l.StatusId) AS StatusId,
        COUNT(l.LeadId) AS count
      FROM Leads l
      LEFT JOIN LatestActivity la
        ON la.LeadId = l.LeadId
        AND la.rn = 1
      ${isAdmin ? "" : "WHERE l.OwnerId = ?"}
      GROUP BY COALESCE(la.StatusId, l.StatusId)
      ORDER BY StatusId
    `, scopedParams);

    //  3 Leads by Status (BAR CHART)
    const [leadsByStatus]: any = await pool.query(`
      ${latestActivityCTE}
      SELECT
        ls.StatusName,
        COUNT(l.LeadId) AS count,
        ls.SortOrder
      FROM Leads l
      LEFT JOIN LatestActivity la
        ON la.LeadId = l.LeadId
        AND la.rn = 1
      LEFT JOIN LeadStatuses ls
        ON ls.StatusId = COALESCE(la.StatusId, l.StatusId)
      ${isAdmin ? "" : "WHERE l.OwnerId = ?"}
      GROUP BY ls.StatusName, ls.SortOrder
      ORDER BY ls.SortOrder
    `, scopedParams);

    //  4 Leads by Owner
    const [leadsByOwner]: any = await pool.query(`
      SELECT
        u.UserName AS OwnerName,
        COUNT(l.LeadId) AS count
      FROM Leads l
      INNER JOIN Users u
        ON l.OwnerId = u.UserId
      ${isAdmin ? "" : "WHERE l.OwnerId = ?"}
      GROUP BY u.UserName
      ORDER BY count DESC
    `, scopedParams);

    //  5 Monthly Trends by Owner
    const [monthlyTrends]: any = await pool.query(`
      SELECT
        DATE_FORMAT(COALESCE(l.LeadDate, l.CreatedOn), '%b %Y') AS MonthYear,
        YEAR(COALESCE(l.LeadDate, l.CreatedOn)) AS YearNum,
        MONTH(COALESCE(l.LeadDate, l.CreatedOn)) AS MonthNum,
        u.UserName AS OwnerName,
        COUNT(l.LeadId) AS count
      FROM Leads l
      INNER JOIN Users u
        ON l.OwnerId = u.UserId
      ${
        isAdmin
          ? "WHERE COALESCE(l.LeadDate, l.CreatedOn) >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 12 MONTH) AND COALESCE(l.LeadDate, l.CreatedOn) < DATE_ADD(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 1 MONTH)"
          : "WHERE l.OwnerId = ? AND COALESCE(l.LeadDate, l.CreatedOn) >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 12 MONTH) AND COALESCE(l.LeadDate, l.CreatedOn) < DATE_ADD(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 1 MONTH)"
      }
      GROUP BY
        DATE_FORMAT(COALESCE(l.LeadDate, l.CreatedOn), '%b %Y'),
        YEAR(COALESCE(l.LeadDate, l.CreatedOn)),
        MONTH(COALESCE(l.LeadDate, l.CreatedOn)),
        u.UserName
      ORDER BY
        YearNum,
        MonthNum
    `, scopedParams);

    // 6 Outreach Analytics
    const [outreachRows]: any = await pool.query(
      `
      SELECT
        COALESCE(SUM(CASE WHEN lc.LinkedInRequestSent = 1 THEN 1 ELSE 0 END), 0) AS totalLinkedInRequestsSent,
        COALESCE(SUM(CASE WHEN lc.LinkedInRequestAccepted = 1 THEN 1 ELSE 0 END), 0) AS totalLinkedInRequestsAccepted,
        COALESCE(SUM(CASE WHEN lc.EmailSent = 1 THEN 1 ELSE 0 END), 0) AS totalEmailsSent
      FROM LeadContacts lc
      INNER JOIN Leads l
        ON l.LeadId = lc.LeadId
      ${isAdmin ? "" : "WHERE l.OwnerId = ?"}
      `,
      scopedParams
    );

    const totalLinkedInRequestsSent = Number(
      outreachRows?.[0]?.totalLinkedInRequestsSent ?? 0
    );
    const totalLinkedInRequestsAccepted = Number(
      outreachRows?.[0]?.totalLinkedInRequestsAccepted ?? 0
    );
    const totalEmailsSent = Number(outreachRows?.[0]?.totalEmailsSent ?? 0);
    const acceptanceRate =
      totalLinkedInRequestsSent > 0
        ? Number(
            (
              (totalLinkedInRequestsAccepted / totalLinkedInRequestsSent) *
              100
            ).toFixed(1)
          )
        : 0;

    const engagementEfficiency =
      totalLinkedInRequestsSent > 0
        ? Number(
            (
              ((totalLinkedInRequestsAccepted +
                Math.min(totalEmailsSent, totalLinkedInRequestsSent)) /
                (totalLinkedInRequestsSent * 2)) *
              100
            ).toFixed(1)
          )
        : 0;

    //  RESPONSE
    return NextResponse.json({
      totalLeads: totalRows[0]?.totalLeads ?? 0,
      statusCounts,
      leadsByStatus,
      leadsByOwner,
      monthlyTrends,
      outreachAnalytics: {
        totalLinkedInRequestsSent,
        totalLinkedInRequestsAccepted,
        totalEmailsSent,
        acceptanceRate,
        engagementEfficiency,
      },
    });
  } catch (error) {
    console.error("DASHBOARD ROUTE ERROR:", error);
    return NextResponse.json(
      { error: "Failed to fetch dashboard data" },
      { status: 500 }
    );
  }
}
