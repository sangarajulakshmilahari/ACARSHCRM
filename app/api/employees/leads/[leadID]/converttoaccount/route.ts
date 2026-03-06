import { NextResponse } from "next/server";
import { getPool } from "@/config/db";

export async function POST(
  req: Request,
  { params }: { params: { leadID: string } }
) {
  const leadId = Number(params.leadID);

  if (isNaN(leadId)) {
    return NextResponse.json({ error: "Invalid LeadId" }, { status: 400 });
  }

  const pool = await getPool();
  let conn: any;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    // 1️⃣ Check current AccountTypeId (MUST be Lead = 10)
    const [leadRows]: any = await conn.query(
      `SELECT AccountTypeId FROM Leads WHERE LeadId = ?`,
      [leadId]
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
      `,
      [accountTypeId, leadId]
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
