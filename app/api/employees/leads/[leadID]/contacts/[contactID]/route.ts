import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";

// PATCH — update outreach fields on a single contact
export async function PATCH(
  req: NextRequest,
  { params }: { params: { leadID: string; contactID: string } }
) {
  const contactId = Number(params.contactID);
  const leadId = Number(params.leadID);

  if (isNaN(contactId) || isNaN(leadId)) {
    return NextResponse.json({ error: "Invalid IDs" }, { status: 400 });
  }

  const body = await req.json();
  const { LinkedInRequestSent, LinkedInRequestAccepted, EmailSent } = body;

  const pool = await getPool();
  const conn = await pool.getConnection();

  try {
    const fields: string[] = [];
    const values: any[] = [];

    if (LinkedInRequestSent !== undefined) {
      fields.push("LinkedInRequestSent = ?");
      values.push(LinkedInRequestSent ? 1 : 0);
    }
    if (LinkedInRequestAccepted !== undefined) {
      fields.push("LinkedInRequestAccepted = ?");
      values.push(LinkedInRequestAccepted ? 1 : 0);
    }
    if (EmailSent !== undefined) {
      fields.push("EmailSent = ?");
      values.push(EmailSent ? 1 : 0);
    }

    if (fields.length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    values.push(contactId, leadId);

    await conn.query(
      `UPDATE LeadContacts SET ${fields.join(", ")} WHERE LeadContactID = ? AND LeadId = ?`,
      values
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Patch contact error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update contact" },
      { status: 500 }
    );
  } finally {
    conn.release();
  }
}
