import { NextResponse } from "next/server";
import { getPool } from "@/config/db";

export async function GET() {
  try {
    const pool = await getPool();


    //  Opportunity Statuses

    const [opportunityStatuses]: any = await pool.query(`
      SELECT
        Opportunity_StatusId,
        Opportunities_StatusName
      FROM Opportunities_Status
      ORDER BY Opportunity_StatusId
    `);


    //  Lead Statuses

    const [leadStatuses]: any = await pool.query(`
      SELECT
        StatusId,
        StatusName,
        StatusDesc,
        SortOrder,
        ColorCode
      FROM LeadStatuses
      ORDER BY SortOrder, StatusId
    `);


    //  Companies

    const [companies]: any = await pool.query(`
      SELECT DISTINCT CompanyName
      FROM Leads
      WHERE CompanyName IS NOT NULL
      ORDER BY CompanyName
    `);


    //  Lead Sources

    const [leadSources]: any = await pool.query(`
      SELECT DISTINCT LeadSource
      FROM Leads
      WHERE LeadSource IS NOT NULL
      ORDER BY LeadSource
    `);


    //  Owners

    const [ownername]: any = await pool.query(`
      SELECT DISTINCT UserId, UserName
      FROM Users
      WHERE UserName IS NOT NULL
      ORDER BY UserId
    `);


    //  Contact Roles

    const [Role]: any = await pool.query(`
      SELECT DISTINCT Role
      FROM ContactRoles
      WHERE Role IS NOT NULL
      ORDER BY Role
    `);


    //  Engagement Models

    const [engagementModels]: any = await pool.query(`
      SELECT
        EngagementId,
        Engagement_ModelName
      FROM Engagement_Models
      ORDER BY EngagementId
    `);


    //  Services

    const [services]: any = await pool.query(`
      SELECT
        ServiceId,
        ServiceName
      FROM Services
      ORDER BY ServiceId
    `);

    return NextResponse.json({
      opportunityStatuses,
      leadStatuses,
      companies,
      leadSources,
      ownername,
      Role,
      engagementModels,
      services,
    });
  } catch (error) {
    console.error("Error fetching master data:", error);
    return NextResponse.json(
      { error: "Failed to fetch statuses" },
      { status: 500 }
    );
  }
}
