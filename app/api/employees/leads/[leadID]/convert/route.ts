import { NextResponse } from "next/server";
import { getPool } from "@/config/db";

export async function POST(
  req: Request,
  { params }: { params: { leadID: string } }
) {
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
      `,
      [leadId]
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
      `,
      [accountTypeId, leadId]
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
