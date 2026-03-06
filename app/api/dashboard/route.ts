import { NextResponse } from "next/server";
import { getPool } from "@/config/db";

export async function GET() {
  try {
    const pool = await getPool();

  
      //  1 Total Leads
  
    const [totalRows]: any = await pool.query(`
      SELECT COUNT(LeadId) AS totalLeads
      FROM Leads
    `);

   
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
      GROUP BY COALESCE(la.StatusId, l.StatusId)
      ORDER BY StatusId
    `);

    
      //  3 Leads by Status (BAR CHART)
  
    const [leadsByStatus]: any = await pool.query(`
      ${latestActivityCTE}
      SELECT
        ls.StatusName,
        COUNT(l.LeadId) AS count
      FROM LeadStatuses ls
      LEFT JOIN Leads l
        ON ls.StatusId = (
          SELECT COALESCE(la.StatusId, l2.StatusId)
          FROM Leads l2
          LEFT JOIN LatestActivity la
            ON la.LeadId = l2.LeadId
            AND la.rn = 1
          WHERE l2.LeadId = l.LeadId
        )
      GROUP BY ls.StatusName, ls.SortOrder
      ORDER BY ls.SortOrder
    `);

    
      //  4 Leads by Owner
 
    const [leadsByOwner]: any = await pool.query(`
      SELECT
        u.UserName AS OwnerName,
        COUNT(l.LeadId) AS count
      FROM Leads l
      INNER JOIN Users u
        ON l.OwnerId = u.UserId
      GROUP BY u.UserName
      ORDER BY count DESC
    `);

   
      //  5 Monthly Trends by Owner
 
    const [monthlyTrends]: any = await pool.query(`
      SELECT
        DATE_FORMAT(l.LeadDate, '%b %Y') AS MonthYear,
        YEAR(l.LeadDate) AS YearNum,
        MONTH(l.LeadDate) AS MonthNum,
        u.UserName AS OwnerName,
        COUNT(l.LeadId) AS count
      FROM Leads l
      INNER JOIN Users u
        ON l.OwnerId = u.UserId
      GROUP BY
        DATE_FORMAT(l.LeadDate, '%b %Y'),
        YEAR(l.LeadDate),
        MONTH(l.LeadDate),
        u.UserName
      ORDER BY
        YearNum,
        MonthNum
    `);

  
      //  RESPONSE
    
    return NextResponse.json({
      totalLeads: totalRows[0]?.totalLeads ?? 0,
      statusCounts,
      leadsByStatus,
      leadsByOwner,
      monthlyTrends,
    });
  } catch (error) {
    console.error("DASHBOARD ROUTE ERROR:", error);
    return NextResponse.json(
      { error: "Failed to fetch dashboard data" },
      { status: 500 }
    );
  }
}
