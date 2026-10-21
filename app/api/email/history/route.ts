import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import { getAuthUser } from "@/app/api/lib/auth";
import { getEmailAttachmentSummaryByEmailIds } from "@/app/api/lib/email-attachments";
import { CompanyRequiredError, requireCompanyId } from "@/app/api/lib/company-tenancy";
import {
  buildLeadOwnerVisibilityClause,
} from "@/app/api/lib/lead-access";
import { ensureEmailDeliverySchema } from "@/app/api/lib/email-delivery";

const ALLOWED_STATUSES = new Set(["QUEUED", "SENDING", "SENT", "FAILED", "SUPPRESSED"]);

export async function GET(req: NextRequest) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const query = req.nextUrl.searchParams;
    const leadContactIdRaw = query.get("leadContactId");
    const leadIdRaw = query.get("leadId");
    const search = String(query.get("search") || "").trim();
    const statusRaw = String(query.get("status") || "").trim().toUpperCase();
    const page = Math.max(1, Number(query.get("page") || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.get("pageSize") || 20)));
    const offset = (page - 1) * pageSize;

    const leadContactId = leadContactIdRaw ? Number(leadContactIdRaw) : null;
    const leadId = leadIdRaw ? Number(leadIdRaw) : null;

    if (leadContactIdRaw && (!Number.isInteger(leadContactId) || Number(leadContactId) <= 0)) {
      return NextResponse.json({ error: "Invalid leadContactId" }, { status: 400 });
    }

    if (leadIdRaw && (!Number.isInteger(leadId) || Number(leadId) <= 0)) {
      return NextResponse.json({ error: "Invalid leadId" }, { status: 400 });
    }

    if (search.length > 150) {
      return NextResponse.json({ error: "Search text is too long" }, { status: 400 });
    }

    if (statusRaw && !ALLOWED_STATUSES.has(statusRaw)) {
      return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
    }

    const companyId = requireCompanyId(authUser);
    const pool = await getPool();
    await ensureEmailDeliverySchema(pool);
    const visibility = buildLeadOwnerVisibilityClause(authUser, "l");

    const whereClauses: string[] = ["e.CompanyId = ?"];
    const params: Array<string | number> = [companyId];

    if (leadContactId) {
      whereClauses.push("e.LeadContactID = ?");
      params.push(leadContactId);
    }

    if (leadId) {
      whereClauses.push("l.LeadId = ?");
      params.push(leadId);
    }

    if (statusRaw) {
      whereClauses.push("e.Status = ?");
      params.push(statusRaw);
    }

    if (search) {
      whereClauses.push(
        "(COALESCE(lc.ContactName, '') LIKE ? OR COALESCE(l.CompanyName, '') LIKE ? OR COALESCE(e.ToEmail, '') LIKE ? OR COALESCE(e.Subject, '') LIKE ?)"
      );
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }

    whereClauses.push(visibility.clause);
    params.push(...visibility.params);

    const whereSql = `WHERE ${whereClauses.join(" AND ")}`;

    const [countRows]: any = await pool.query(
      `
        SELECT COUNT(*) AS total
        FROM emails e
        INNER JOIN leadcontacts lc ON lc.LeadContactID = e.LeadContactID
        INNER JOIN leads l ON l.LeadId = lc.LeadId
        LEFT JOIN email_templates et ON et.TemplateId = e.TemplateId
        ${whereSql}
      `,
      params
    );

    const total = Number(countRows?.[0]?.total ?? 0);

    const [rows]: any = await pool.query(
      `
        SELECT
          e.EmailId,
          e.LeadContactID,
          e.SequenceId,
          e.StepId,
          e.TemplateId,
          e.ToEmail,
          e.Subject,
          e.Status,
          e.DeliveryStatus,
          e.ScheduledAt,
          e.SentAt,
          e.ProviderMessageId,
          e.ThreadId,
          e.CreatedAt,
          e.UpdatedAt,
          lc.ContactName,
          l.LeadId,
          l.CompanyName,
          et.TemplateName,
          seq.SequenceName,
          st.StepOrder
        FROM emails e
        INNER JOIN leadcontacts lc ON lc.LeadContactID = e.LeadContactID
        INNER JOIN leads l ON l.LeadId = lc.LeadId
        LEFT JOIN email_templates et ON et.TemplateId = e.TemplateId
        LEFT JOIN email_sequences seq ON seq.SequenceId = e.SequenceId
        LEFT JOIN email_sequence_steps st ON st.StepId = e.StepId
        ${whereSql}
        ORDER BY COALESCE(e.SentAt, e.CreatedAt) DESC, e.EmailId DESC
        LIMIT ? OFFSET ?
      `,
      [...params, pageSize, offset]
    );

    const emailIds = (Array.isArray(rows) ? rows : [])
      .map((r: any) => Number(r?.EmailId || 0))
      .filter((id: number) => id > 0);
    const attachmentMap = await getEmailAttachmentSummaryByEmailIds({
      poolOrConn: pool,
      emailIds,
    });

    const items = (Array.isArray(rows) ? rows : []).map((row: any) => ({
      ...row,
      Attachments: attachmentMap.get(Number(row.EmailId || 0)) || [],
    }));

    return NextResponse.json({
      items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
      filters: {
        leadContactId,
        leadId,
        search,
        status: statusRaw || "",
      },
    });
  } catch (error) {
    console.error("[email-history] GET error", error);
    if (error instanceof CompanyRequiredError) {
      return NextResponse.json({ error: "Company membership required" }, { status: 403 });
    }
    return NextResponse.json({ error: "Failed to fetch email history" }, { status: 500 });
  }
}

