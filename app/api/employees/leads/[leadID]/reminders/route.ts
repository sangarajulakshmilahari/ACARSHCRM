import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";


  //  POST → CREATE REMINDER

export async function POST(
  req: NextRequest,
  { params }: { params: { leadID: string } }
) {
  try {
    const { ReminderDate, Notes, Status, Notification } = await req.json();

    /* Validation */
    if (!ReminderDate || !Notes?.trim()) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const leadId = Number(params.leadID);
    if (isNaN(leadId)) {
      return NextResponse.json(
        { error: "Invalid LeadId" },
        { status: 400 }
      );
    }

    const pool = await getPool();

    /* Insert Reminder */
    const [insertResult]: any = await pool.execute(
      `
      INSERT INTO LeadReminders
      (
        LeadId,
        ReminderDate,
        ReminderNote,
        Status,
        NotificationChannels,
        CreatedAt
      )
      VALUES (?, ?, ?, ?, ?, NOW())
      `,
      [
        leadId,
        new Date(ReminderDate),
        Notes,
        Status || "Pending",
        Notification || "Email",
      ]
    );

    /* Fetch inserted row (MySQL replacement for OUTPUT INSERTED) */
    const [rows]: any = await pool.execute(
      `
      SELECT
        ReminderId,
        DATE_FORMAT(ReminderDate, '%Y-%m-%d') AS ReminderDate,
        ReminderNote,
        Status,
        NotificationChannels
      FROM LeadReminders
      WHERE ReminderId = ?
      `,
      [insertResult.insertId]
    );

    return NextResponse.json({
      ReminderId: rows[0].ReminderId,
      ReminderDate: rows[0].ReminderDate,
      Notes: rows[0].ReminderNote,
      Status: rows[0].Status,
      Notification: rows[0].NotificationChannels,
    });
  } catch (error) {
    console.error("Reminder POST error:", error);
    return NextResponse.json(
      { error: "Reminder save failed" },
      { status: 500 }
    );
  }
}


  //  PUT → UPDATE REMINDER

export async function PUT(
  req: NextRequest,
  { params }: { params: { leadID: string } }
) {
  try {
    const {
      ReminderId,
      ReminderDate,
      Notes,
      Status,
      Notification,
    } = await req.json();

    if (!ReminderId) {
      return NextResponse.json(
        { error: "ReminderId is required" },
        { status: 400 }
      );
    }

    const pool = await getPool();

    await pool.execute(
      `
      UPDATE LeadReminders
      SET
        ReminderDate = ?,
        ReminderNote = ?,
        Status = ?,
        NotificationChannels = ?
      WHERE ReminderId = ?
      `,
      [
        new Date(ReminderDate),
        Notes,
        Status,
        Notification,
        ReminderId,
      ]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Reminder PUT error:", error);
    return NextResponse.json(
      { error: "Reminder update failed" },
      { status: 500 }
    );
  }
}
