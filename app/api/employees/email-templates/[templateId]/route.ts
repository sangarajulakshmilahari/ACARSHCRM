import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import { getAuthUser } from "@/app/api/lib/auth";

type TemplatePayload = {
  templateName?: string;
  subject?: string;
  body?: string;
};

function parseTemplateId(rawId: string): number | null {
  const value = Number(rawId);
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
}

function normalizePayload(raw: TemplatePayload) {
  const templateName = String(raw.templateName ?? "").trim();
  const subject = String(raw.subject ?? "").trim();
  const body = String(raw.body ?? "").trim();
  return { templateName, subject, body };
}

function validatePayload(payload: ReturnType<typeof normalizePayload>) {
  if (!payload.templateName) return "Template Name is required";
  if (!payload.subject) return "Subject is required";
  if (!payload.body) return "Email Body is required";
  if (payload.templateName.length > 180) return "Template Name is too long";
  if (payload.subject.length > 500) return "Subject is too long";
  return null;
}

async function fetchTemplateById(templateId: number) {
  const pool = await getPool();
  const [rows]: any = await pool.query(
    `
    SELECT
      et.TemplateId,
      et.TemplateName,
      et.Subject,
      et.Body,
      et.CreatedBy,
      et.CreatedAt,
      et.UpdatedAt,
      COALESCE(u.UserName, '') AS CreatedByName
    FROM email_templates et
    LEFT JOIN Users u
      ON u.UserId = et.CreatedBy
    WHERE et.TemplateId = ?
    LIMIT 1
    `,
    [templateId]
  );

  return rows?.[0] ?? null;
}

export async function PUT(
  req: NextRequest,
  context: { params: { templateId: string } }
) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const templateId = parseTemplateId(context.params.templateId);
    if (!templateId) {
      return NextResponse.json({ error: "Invalid template id" }, { status: 400 });
    }

    const rawBody = (await req.json().catch(() => ({}))) as TemplatePayload;
    const payload = normalizePayload(rawBody);
    const validationError = validatePayload(payload);

    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const pool = await getPool();
    const [result]: any = await pool.query(
      `
      UPDATE email_templates
      SET
        TemplateName = ?,
        Subject = ?,
        Body = ?,
        UpdatedAt = NOW()
      WHERE TemplateId = ?
      `,
      [payload.templateName, payload.subject, payload.body, templateId]
    );

    if (!result?.affectedRows) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    const item = await fetchTemplateById(templateId);

    return NextResponse.json({
      message: "Template updated successfully",
      item,
    });
  } catch (error) {
    console.error("Email templates PUT error:", error);
    return NextResponse.json(
      { error: "Failed to update email template" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: { templateId: string } }
) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const templateId = parseTemplateId(context.params.templateId);
    if (!templateId) {
      return NextResponse.json({ error: "Invalid template id" }, { status: 400 });
    }

    const pool = await getPool();
    const [result]: any = await pool.query(
      `DELETE FROM email_templates WHERE TemplateId = ?`,
      [templateId]
    );

    if (!result?.affectedRows) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Template deleted successfully" });
  } catch (error) {
    console.error("Email templates DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to delete email template" },
      { status: 500 }
    );
  }
}

