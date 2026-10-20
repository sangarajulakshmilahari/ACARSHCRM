import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import { getAuthUser } from "@/app/api/lib/auth";
import { canUserViewLeadById } from "@/app/api/lib/lead-access";
import { loadRecordCompanyId, resolveWriteCompanyId } from "@/app/api/lib/company-tenancy";

function parseReminderDateToUtc(input: unknown): Date | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/
  );

  if (match) {
    const [, y, m, d, hh, mm, ss] = match;
    const year = Number(y);
    const month = Number(m);
    const day = Number(d);
    const hour = Number(hh);
    const minute = Number(mm);
    const second = Number(ss || "0");
    const tzOffsetMinutes = Number(process.env.REMINDER_INPUT_TZ_OFFSET_MINUTES ?? 330);

    const utcMs =
      Date.UTC(year, month - 1, day, hour, minute, second) -
      tzOffsetMinutes * 60 * 1000;
    const parsed = new Date(utcMs);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const fallback = new Date(trimmed);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { leadID: string } }
) {
  try {
    const leadId = Number(params.leadID);
    if (Number.isNaN(leadId)) {
      return NextResponse.json({ error: "Invalid LeadId" }, { status: 400 });
    }

    const authUser = await getAuthUser(req);
    if (!authUser?.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { ReminderDate, Notes, Status, Notification } = await req.json();
    if (!ReminderDate || !String(Notes || "").trim()) {
      return NextResponse.json(
        { error: "ReminderDate and Notes are required" },
        { status: 400 }
      );
    }

    const reminderDateUtc = parseReminderDateToUtc(ReminderDate);
    if (!reminderDateUtc) {
      return NextResponse.json({ error: "Invalid ReminderDate" }, { status: 400 });
    }

    const pool = await getPool();
    const hasLeadAccess = await canUserViewLeadById(pool, authUser, leadId);
    if (!hasLeadAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const companyId = resolveWriteCompanyId(
      authUser.companyId,
      await loadRecordCompanyId(pool, "lead", leadId)
    );

    const [insertResult]: any = await pool.execute(
      `
      INSERT INTO LeadReminders
      (
        LeadId,
        CompanyId,
        ReminderDate,
        ReminderNote,
        Status,
        NotificationChannels,
        CreatedBy,
        IsCompleted,
        EmailSent,
        EmailProcessing
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0)
      `,
      [
        leadId,
        companyId,
        reminderDateUtc,
        String(Notes).trim(),
        String(Status || "Pending"),
        String(Notification || "Email"),
        authUser.userId,
      ]
    );

    const [rows]: any = await pool.execute(
      `
      SELECT
        ReminderId,
        DATE_FORMAT(ReminderDate, '%Y-%m-%d %H:%i:%s') AS ReminderDate,
        ReminderNote,
        Status,
        NotificationChannels
      FROM LeadReminders
      WHERE ReminderId = ?
        AND CompanyId = ?
      `,
      [insertResult.insertId, companyId]
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
    return NextResponse.json({ error: "Reminder save failed" }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { leadID: string } }
) {
  try {
    const leadId = Number(params.leadID);
    if (Number.isNaN(leadId)) {
      return NextResponse.json({ error: "Invalid LeadId" }, { status: 400 });
    }

    const authUser = await getAuthUser(req);
    if (!authUser?.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { ReminderId, ReminderDate, Notes, Status, Notification } = await req.json();
    if (!ReminderId || !ReminderDate || !String(Notes || "").trim()) {
      return NextResponse.json(
        { error: "ReminderId, ReminderDate and Notes are required" },
        { status: 400 }
      );
    }

    const reminderDateUtc = parseReminderDateToUtc(ReminderDate);
    if (!reminderDateUtc) {
      return NextResponse.json({ error: "Invalid ReminderDate" }, { status: 400 });
    }

    const pool = await getPool();
    const hasLeadAccess = await canUserViewLeadById(pool, authUser, leadId);
    if (!hasLeadAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const companyId = resolveWriteCompanyId(
      authUser.companyId,
      await loadRecordCompanyId(pool, "lead", leadId)
    );

    const [result]: any = await pool.execute(
      `
      UPDATE LeadReminders
      SET
        ReminderDate = ?,
        ReminderNote = ?,
        Status = ?,
        NotificationChannels = ?,
        IsCompleted = CASE
          WHEN LOWER(?) IN ('completed', 'done', 'cancelled') THEN 1
          ELSE 0
        END
      WHERE ReminderId = ?
        AND LeadId = ?
        AND CompanyId = ?
      `,
      [
        reminderDateUtc,
        String(Notes).trim(),
        String(Status || "Pending"),
        String(Notification || "Email"),
        String(Status || "Pending"),
        Number(ReminderId),
        leadId,
        companyId,
      ]
    );

    if (!result?.affectedRows) {
      return NextResponse.json(
        { error: "Reminder not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Reminder PUT error:", error);
    return NextResponse.json({ error: "Reminder update failed" }, { status: 500 });
  }
}

