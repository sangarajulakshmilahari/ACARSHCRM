import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import { getAuthUser } from "@/app/api/lib/auth";
import { CompanyRequiredError, requireCompanyId } from "@/app/api/lib/company-tenancy";

export async function GET(req: NextRequest) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const companyId = requireCompanyId(authUser);
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
        AND CompanyId = ?
      ORDER BY CompanyName
    `, [companyId]);


    //  Lead Sources

    const [leadSources]: any = await pool.query(`
      SELECT DISTINCT LeadSource
      FROM Leads
      WHERE LeadSource IS NOT NULL
        AND CompanyId = ?
      ORDER BY LeadSource
    `, [companyId]);


    //  Owners

    const [ownername]: any = await pool.query(`
      SELECT DISTINCT u.UserId, u.UserName
      FROM Users u
      INNER JOIN CompanyUsers cu
        ON cu.UserId = u.UserId
       AND cu.CompanyId = ?
       AND cu.IsActive = 1
      WHERE u.UserName IS NOT NULL
      ORDER BY u.UserId
    `, [companyId]);


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


    //  Probabilities

    const [probabilities]: any = await pool.query(`
      SELECT
        ProbabilityId,
        ProbabilityRange
      FROM Probability
      ORDER BY ProbabilityId
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
      probabilities,
    });
  } catch (error) {
    if (error instanceof CompanyRequiredError) {
      return NextResponse.json({ error: "Company membership required" }, { status: 403 });
    }
    console.error("Error fetching master data:", error);
    return NextResponse.json(
      { error: "Failed to fetch statuses" },
      { status: 500 }
    );
  }
}
