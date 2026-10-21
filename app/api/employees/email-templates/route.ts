import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import { getAuthUser } from "@/app/api/lib/auth";

type TemplatePayload = {
  templateName?: string;
  subject?: string;
  body?: string;
};

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

export async function GET(req: NextRequest) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
      WHERE et.CompanyId = ?
      ORDER BY COALESCE(et.UpdatedAt, et.CreatedAt) DESC, et.TemplateId DESC
      `,
      [authUser.companyId]
    );

    return NextResponse.json(rows ?? []);
  } catch (error) {
    console.error("Email templates GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch email templates" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
      INSERT INTO email_templates
        (TemplateName, Subject, Body, CreatedBy, CompanyId, CreatedAt, UpdatedAt)
      VALUES (?, ?, ?, ?, ?, NOW(), NOW())
      `,
      [payload.templateName, payload.subject, payload.body, authUser.userId, authUser.companyId]
    );

    const templateId = Number(result?.insertId ?? 0);

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

    return NextResponse.json(
      {
        message: "Template created successfully",
        item: rows?.[0] ?? null,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Email templates POST error:", error);
    return NextResponse.json(
      { error: "Failed to create email template" },
      { status: 500 }
    );
  }
}

