import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getPool } from "@/config/db";
import { loadActiveCompanyId } from "@/app/api/lib/company-tenancy";
import { calculateAndStoreLeadScore } from "@/app/api/lib/lead-scoring";

type ColumnMeta = {
  isNullable: boolean;
  maxLength: number | null;
};

export function resolveWebsiteIntakeCompanyId(raw: unknown): number | null {
  const companyId = Number(raw);
  if (!Number.isInteger(companyId) || companyId <= 0) return null;
  return companyId;
}

function unauthorizedResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function secureEquals(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function enforceMaxLength(
  value: string,
  meta: ColumnMeta | undefined,
  tooLongMessage: string,
): string | null {
  if (!value) return value;
  const maxLength = meta?.maxLength ?? null;
  if (typeof maxLength === "number" && maxLength > 0 && value.length > maxLength) {
    return tooLongMessage;
  }
  return null;
}

async function readColumnMeta(
  conn: any,
  tableName: string,
  columnNames: string[],
): Promise<Record<string, ColumnMeta>> {
  if (!columnNames.length) return {};

  const placeholders = columnNames.map(() => "?").join(", ");
  const [rows]: any = await conn.query(
    `
      SELECT COLUMN_NAME, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME IN (${placeholders})
    `,
    [tableName, ...columnNames],
  );

  const meta: Record<string, ColumnMeta> = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const columnName = String(row.COLUMN_NAME || "");
    meta[columnName] = {
      isNullable: String(row.IS_NULLABLE || "").toUpperCase() === "YES",
      maxLength:
        row.CHARACTER_MAXIMUM_LENGTH == null
          ? null
          : Number(row.CHARACTER_MAXIMUM_LENGTH),
    };
  }

  return meta;
}

export async function POST(req: NextRequest) {
  const providedApiKey = req.headers.get("x-api-key");
  const expectedApiKey = process.env.WEBSITE_CRM_API_KEY;

  if (!providedApiKey || !expectedApiKey) {
    return unauthorizedResponse();
  }

  if (!secureEquals(providedApiKey, expectedApiKey)) {
    return unauthorizedResponse();
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const contactName = asTrimmedString((body as any).ContactName);
  const contactEmail = asTrimmedString((body as any).ContactEmail);
  const interest = asTrimmedString((body as any).Interest);
  const message = asTrimmedString((body as any).Message);

  if (!contactName) {
    return NextResponse.json({ error: "Contact name is required" }, { status: 400 });
  }
  if (!contactEmail) {
    return NextResponse.json({ error: "Contact email is required" }, { status: 400 });
  }
  if (!looksLikeEmail(contactEmail)) {
    return NextResponse.json({ error: "Contact email is invalid" }, { status: 400 });
  }
  if (!interest) {
    return NextResponse.json({ error: "Interest is required" }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  const pool = await getPool();
  let conn: any;
  let transactionStarted = false;

  try {
    conn = await pool.getConnection();

    const [leadMeta, contactMeta] = await Promise.all([
      readColumnMeta(conn, "Leads", ["CompanyName", "CompanyLocation", "LeadSource", "LeadNotes"]),
      readColumnMeta(conn, "LeadContacts", ["ContactName", "ContactEmail", "ContactNotes"]),
    ]);

    const leadSource = "Website";
    const contactNotes = `Interested In: ${interest}`;

    const validationError =
      enforceMaxLength(contactName, contactMeta.ContactName, "Contact name is too long") ||
      enforceMaxLength(contactEmail, contactMeta.ContactEmail, "Contact email is too long") ||
      enforceMaxLength(contactNotes, contactMeta.ContactNotes, "Interest is too long") ||
      enforceMaxLength(message, leadMeta.LeadNotes, "Message is too long") ||
      enforceMaxLength(leadSource, leadMeta.LeadSource, "Lead source is too long");

    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const companyName = leadMeta.CompanyName?.isNullable ? null : "Website Inquiry";
    const companyLocation = leadMeta.CompanyLocation?.isNullable ? null : "";

    const [roleRows]: any = await conn.query(
      `SELECT RoleId FROM ContactRoles WHERE RoleId = 130 LIMIT 1`,
    );
    if (!Array.isArray(roleRows) || !roleRows.length) {
      throw new Error("Required ContactRoleId 130 not found");
    }

    const configuredCompanyId = resolveWebsiteIntakeCompanyId(process.env.WEBSITE_CRM_COMPANY_ID);
    const companyId = await loadActiveCompanyId(conn, configuredCompanyId);
    if (!companyId) {
      return NextResponse.json(
        { error: "Website intake is not configured" },
        { status: 503 }
      );
    }

    await conn.beginTransaction();
    transactionStarted = true;

    const [leadInsert]: any = await conn.query(
      `
        INSERT INTO Leads
          (CompanyName, CompanyLocation, LeadSource, LeadDate, LeadNotes, OwnerId, CompanyId)
        VALUES (?, ?, ?, NOW(), ?, ?, ?)
      `,
      [companyName, companyLocation, leadSource, message, null, companyId],
    );

    const leadId = Number(leadInsert?.insertId);

    if (!Number.isFinite(leadId) || leadId <= 0) {
  throw new Error("Failed to create lead");
}
    await conn.query(
      `
        INSERT INTO LeadContacts
          (LeadId, CompanyId, ContactName, ContactEmail, ContactNotes, ContactRoleId, EmailSent)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [leadId, companyId, contactName, contactEmail, contactNotes, 130, 0],
    );

    await calculateAndStoreLeadScore(conn, leadId);

    await conn.commit();

    return NextResponse.json(
      {
        message: "Website lead created successfully",
        LeadId: leadId,
      },
      { status: 201 },
    );
  } catch (error) {
    if (conn && transactionStarted) {
      await conn.rollback();
    }
    console.error("Error creating website lead:", error);
    return NextResponse.json(
      { error: "Failed to create website lead" },
      { status: 500 },
    );
  } finally {
    if (conn) {
      conn.release();
    }
  }
}

