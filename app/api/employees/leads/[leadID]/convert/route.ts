import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import { getAuthUser } from "@/app/api/lib/auth";
import { CompanyRequiredError, requireCompanyId } from "@/app/api/lib/company-tenancy";
import { canUserViewLeadById } from "@/app/api/lib/lead-access";

export async function POST(
  req: NextRequest,
  { params }: { params: { leadID: string } }
) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const leadId = Number(params.leadID);

  let requestedTarget: string | undefined;
  try {
    const body = await req.json();
    if (body && typeof body.target === "string") {
      requestedTarget = body.target.trim();
    }
  } catch {
    requestedTarget = undefined;
  }

  if (isNaN(leadId)) {
    return NextResponse.json(
      { error: "Invalid LeadId" },
      { status: 400 }
    );
  }

  const pool = await getPool();
  let companyId: number;
  try {
    companyId = requireCompanyId(authUser);
  } catch (error) {
    if (error instanceof CompanyRequiredError) {
      return NextResponse.json({ error: "Company membership required" }, { status: 403 });
    }
    throw error;
  }
  const hasLeadAccess = await canUserViewLeadById(pool, authUser, leadId);
  if (!hasLeadAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let conn: any;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

   
      //  1 Get current account type
    
    const [currentTypeRows]: any = await conn.query(
      `
      SELECT at.Name
      FROM Leads l
      LEFT JOIN AccountTypes at
        ON l.AccountTypeId = at.AccountTypeId
      WHERE l.LeadId = ?
        AND l.CompanyId = ?
      `,
      [leadId, companyId]
    );

    const currentType = currentTypeRows[0]?.Name ?? "Lead";


      //  2 Determine next stage

    const NEXT_STAGE: Record<string, string> = {
      Lead: "Prospect",
      Prospect: "Account",
      Account: "MasterAccount",
    };

    const allowedTargetsByCurrentType: Record<string, string[]> = {
      Lead: ["Prospect", "Account"],
      Prospect: ["Lead", "Account"],
      Account: ["MasterAccount"],
    };

    const targetType = requestedTarget || NEXT_STAGE[currentType];

    if (
      requestedTarget &&
      (!allowedTargetsByCurrentType[currentType] ||
        !allowedTargetsByCurrentType[currentType].includes(requestedTarget))
    ) {
      await conn.rollback();
      return NextResponse.json(
        {
          error: `Invalid target conversion from ${currentType} to ${requestedTarget}`,
        },
        { status: 400 }
      );
    }

    if (!targetType) {
      await conn.rollback();
      return NextResponse.json(
        { error: "No further conversion possible" },
        { status: 400 }
      );
    }


      //  3 Get AccountTypeId for target stage
    
    const [typeRows]: any = await conn.query(
      `
      SELECT AccountTypeId
      FROM AccountTypes
      WHERE Name = ?
      `,
      [targetType]
    );

    if (!typeRows.length) {
      throw new Error("Target AccountType not found");
    }

    const accountTypeId = typeRows[0].AccountTypeId;

    
      //  4 Update Lead
  
    await conn.query(
      `
      UPDATE Leads
      SET AccountTypeId = ?
      WHERE LeadId = ?
        AND CompanyId = ?
      `,
      [accountTypeId, leadId, companyId]
    );

    await conn.commit();

    return NextResponse.json({
      message: "Converted successfully",
      from: currentType,
      to: targetType,
    });
  } catch (err: any) {
    if (conn) await conn.rollback();
    console.error("Convert error:", err);

    return NextResponse.json(
      { error: err.message || "Conversion failed" },
      { status: 500 }
    );
  } finally {
    if (conn) conn.release();
  }
}
