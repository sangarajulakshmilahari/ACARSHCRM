import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import { getAuthUser } from "@/app/api/lib/auth";
import { getEmailAttachments } from "@/app/api/lib/email-attachments";
import { CompanyRequiredError, requireCompanyId } from "@/app/api/lib/company-tenancy";
import {
  buildLeadOwnerVisibilityClause,
} from "@/app/api/lib/lead-access";
import { ensureEmailDeliverySchema } from "@/app/api/lib/email-delivery";

type Params = {
  params: {
    emailId: string;
  };
};

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const emailId = Number(params?.emailId || 0);
    if (!Number.isInteger(emailId) || emailId <= 0) {
      return NextResponse.json({ error: "Invalid emailId" }, { status: 400 });
    }

    const companyId = requireCompanyId(authUser);
    const pool = await getPool();
    await ensureEmailDeliverySchema(pool);
    const visibility = buildLeadOwnerVisibilityClause(authUser, "l");

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
          e.Body,
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
          st.StepOrder,
          owner.UserName AS OwnerName
        FROM emails e
        INNER JOIN leadcontacts lc ON lc.LeadContactID = e.LeadContactID
        INNER JOIN leads l ON l.LeadId = lc.LeadId
        LEFT JOIN email_templates et ON et.TemplateId = e.TemplateId
        LEFT JOIN email_sequences seq ON seq.SequenceId = e.SequenceId
        LEFT JOIN email_sequence_steps st ON st.StepId = e.StepId
        LEFT JOIN users owner ON owner.UserId = l.OwnerId
        WHERE e.EmailId = ?
          AND e.CompanyId = ?
          AND ${visibility.clause}
        LIMIT 1
      `,
      [emailId, companyId, ...visibility.params]
    );

    const email = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (!email) {
      return NextResponse.json({ error: "Email record not found" }, { status: 404 });
    }

    const [events]: any = await pool.query(
      `
        SELECT
          EventId,
          EmailId,
          EventType,
          EventTime,
          Metadata,
          CreatedAt
        FROM email_events
        WHERE EmailId = ?
          AND CompanyId = ?
        ORDER BY EventTime ASC, EventId ASC
      `,
      [emailId, companyId]
    );

    const attachments = await getEmailAttachments({
      poolOrConn: pool,
      emailId,
      includeContent: false,
    });

    return NextResponse.json({
      email: {
        ...email,
        Attachments: attachments,
      },
      events: Array.isArray(events) ? events : [],
    });
  } catch (error) {
    console.error("[email-history-detail] GET error", error);
    if (error instanceof CompanyRequiredError) {
      return NextResponse.json({ error: "Company membership required" }, { status: 403 });
    }
    return NextResponse.json({ error: "Failed to fetch email detail" }, { status: 500 });
  }
}

