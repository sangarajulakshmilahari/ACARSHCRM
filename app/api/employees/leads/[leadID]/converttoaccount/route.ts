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

  if (isNaN(leadId)) {
    return NextResponse.json({ error: "Invalid LeadId" }, { status: 400 });
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

    // 1️⃣ Check current AccountTypeId (MUST be Lead = 10)
    const [leadRows]: any = await conn.query(
      `SELECT AccountTypeId FROM Leads WHERE LeadId = ? AND CompanyId = ?`,
      [leadId, companyId]
    );

    if (!leadRows.length) {
      throw new Error("Lead not found");
    }

    if (leadRows[0].AccountTypeId !== 10) {
      return NextResponse.json(
        { error: "Only Leads can be directly converted to Account" },
        { status: 400 }
      );
    }

    // 2️⃣ Get AccountTypeId for Account (30)
    const [typeRows]: any = await conn.query(
      `SELECT AccountTypeId FROM AccountTypes WHERE Name = 'Account'`
    );

    if (!typeRows.length) {
      throw new Error("Account type not found");
    }

    const accountTypeId = typeRows[0].AccountTypeId; // should be 30

    // 3️⃣ Update lead → Account
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
      message: "Converted directly to Account",
      from: "Lead",
      to: "Account",
    });
  } catch (err: any) {
    if (conn) await conn.rollback();
    console.error("Convert-to-account error:", err);

    return NextResponse.json(
      { error: err.message || "Conversion failed" },
      { status: 500 }
    );
  } finally {
    if (conn) conn.release();
  }
}
