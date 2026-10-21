import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import { resolveAuthUser } from "@/app/api/lib/auth";
import { canUserViewLeadById } from "@/app/api/lib/lead-access";
import {
  GraphDelegatedAuthError,
  getDelegatedGraphSession,
} from "@/app/api/lib/graph-delegated";
import { dispatchQueuedEmailByIdWithDelegated } from "@/app/api/lib/email-dispatch";
import {
  normalizeIncomingEmailAttachments,
  saveEmailAttachments,
} from "@/app/api/lib/email-attachments";
import {
  renderEmailTemplateWithVariables,
  renderTemplateVariables,
} from "@/app/utils/email-content";
import { isEmailSuppressed } from "@/app/api/lib/email-suppressions";

type SendAction = "send_now" | "schedule";

type SendEmailBody = {
  action?: SendAction;
  templateId?: number | null;
  subject?: string;
  body?: string;
  scheduleAt?: string | null;
  recipients?: Array<{
    leadContactId?: number;
  }>;
  attachments?: Array<{
    fileName?: string;
    contentType?: string;
    contentBase64?: string;
    isInline?: boolean;
    contentId?: string;
  }>;
};

type LeadContactRow = {
  LeadContactID: number;
  LeadId: number;
  ContactName: string | null;
  ContactEmail: string | null;
  CompanyName: string | null;
  CompanyId: number | null;
  LeadCompanyId: number | null;
};

type ActionResult = {
  leadContactId: number;
  success: boolean;
  emailId?: number;
  error?: string;
  stage?: "validation" | "authz" | "queue" | "send";
};

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

function isValidEmail(value: string): boolean {
  return emailRegex.test(String(value || "").trim());
}

function sanitizeSubject(subject: string): string {
  return String(subject || "")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function parseFutureScheduleAt(value: string | null | undefined): Date | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return null;
  if (dt.getTime() <= Date.now()) return null;
  return dt;
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await resolveAuthUser(req);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = (await req.json().catch(() => ({}))) as SendEmailBody;
    const action: SendAction = payload.action === "schedule" ? "schedule" : "send_now";

    const templateId =
      payload.templateId === null || payload.templateId === undefined
        ? null
        : Number(payload.templateId);
    const subjectInput = sanitizeSubject(String(payload.subject || ""));
    const bodyInput = String(payload.body || "").trim();
    const normalizedAttachmentsResult = normalizeIncomingEmailAttachments(payload.attachments);
    if (normalizedAttachmentsResult.error) {
      return NextResponse.json({ error: normalizedAttachmentsResult.error }, { status: 400 });
    }
    const normalizedAttachments = normalizedAttachmentsResult.attachments;

    if (!subjectInput) {
      return NextResponse.json({ error: "Subject is required" }, { status: 400 });
    }

    if (!bodyInput) {
      return NextResponse.json({ error: "Body is required" }, { status: 400 });
    }

    if (subjectInput.length > 500) {
      return NextResponse.json({ error: "Subject is too long" }, { status: 400 });
    }

    if (bodyInput.length > 20000) {
      return NextResponse.json({ error: "Body is too long" }, { status: 400 });
    }

    const recipientIds = Array.from(
      new Set(
        (Array.isArray(payload.recipients) ? payload.recipients : [])
          .map((r) => Number(r?.leadContactId || 0))
          .filter((id) => Number.isFinite(id) && id > 0)
      )
    );

    if (recipientIds.length === 0) {
      return NextResponse.json(
        { error: "At least one recipient leadContactId is required" },
        { status: 400 }
      );
    }

    const scheduleAt = action === "schedule" ? parseFutureScheduleAt(payload.scheduleAt) : null;
    if (action === "schedule" && !scheduleAt) {
      return NextResponse.json(
        { error: "Scheduled datetime is required and must be in the future" },
        { status: 400 }
      );
    }

    const pool = await getPool();

    if (templateId !== null) {
      if (!Number.isFinite(templateId) || templateId <= 0) {
        return NextResponse.json({ error: "Invalid templateId" }, { status: 400 });
      }

      const [templateRows]: any = await pool.query(
        `SELECT TemplateId FROM email_templates WHERE TemplateId = ? LIMIT 1`,
        [templateId]
      );

      if (!Array.isArray(templateRows) || templateRows.length === 0) {
        return NextResponse.json({ error: "Template not found" }, { status: 404 });
      }
    }

    let graphSession:
      | {
          accessToken: string;
          setCookieHeaders: string[];
        }
      | undefined;

    if (action === "send_now") {
      try {
        const delegated = await getDelegatedGraphSession(req);
        graphSession = {
          accessToken: delegated.accessToken,
          setCookieHeaders: delegated.setCookieHeaders,
        };
      } catch (error: any) {
        if (error instanceof GraphDelegatedAuthError) {
          return NextResponse.json(
            {
              error: error.safeMessage,
              code: error.code,
            },
            { status: error.status }
          );
        }
        throw error;
      }
    }

    const results: ActionResult[] = [];

    for (const leadContactId of recipientIds) {
      const [contactRows]: any = await pool.query(
        `
          SELECT
            lc.LeadContactID,
            lc.LeadId,
            lc.ContactName,
            lc.ContactEmail,
            lc.CompanyId,
            l.CompanyName,
            l.CompanyId AS LeadCompanyId
          FROM leadcontacts lc
          INNER JOIN leads l ON l.LeadId = lc.LeadId
          WHERE lc.LeadContactID = ?
          LIMIT 1
        `,
        [leadContactId]
      );

      const contact =
        (Array.isArray(contactRows) && contactRows[0]) as LeadContactRow | undefined;

      if (!contact) {
        results.push({
          leadContactId,
          success: false,
          error: "Recipient contact was not found",
          stage: "validation",
        });
        continue;
      }

      const hasAccess = await canUserViewLeadById(pool, authUser, Number(contact.LeadId));
      if (!hasAccess) {
        results.push({
          leadContactId,
          success: false,
          error: "You do not have access to this lead/contact",
          stage: "authz",
        });
        continue;
      }

      const toEmail = String(contact.ContactEmail || "").trim();
      if (!toEmail || !isValidEmail(toEmail)) {
        results.push({
          leadContactId,
          success: false,
          error: "Recipient email is missing or invalid",
          stage: "validation",
        });
        continue;
      }

      const companyId = Number(contact.CompanyId || contact.LeadCompanyId || 0);
      if (!(companyId > 0) || await isEmailSuppressed(pool, toEmail, companyId)) {
        results.push({
          leadContactId,
          success: false,
          error: !(companyId > 0) ? "Recipient company is missing" : "Recipient is unsubscribed",
          stage: "validation",
        });
        continue;
      }

      const renderedSubject = renderTemplateVariables(subjectInput, {
        contactName: String(contact.ContactName || "").trim(),
        companyName: String(contact.CompanyName || "").trim(),
        senderName: authUser.userName,
      });
      const renderedBody = renderEmailTemplateWithVariables(bodyInput, {
        contactName: String(contact.ContactName || "").trim(),
        companyName: String(contact.CompanyName || "").trim(),
        senderName: authUser.userName,
      });

      const [insertRes]: any = await pool.query(
        `
          INSERT INTO emails (
            LeadContactID,
            CompanyId,
            SequenceId,
            StepId,
            TemplateId,
            ToEmail,
            Subject,
            Body,
            Status,
            ScheduledAt,
            SentAt,
            ProviderMessageId,
            ThreadId
          )
          VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, 'QUEUED', ?, NULL, NULL, NULL)
        `,
        [
          leadContactId,
          authUser.companyId,
          templateId,
          toEmail,
          renderedSubject,
          renderedBody,
          action === "schedule" && scheduleAt
            ? scheduleAt.toISOString().slice(0, 19).replace("T", " ")
            : null,
        ]
      );

      const emailId = Number(insertRes?.insertId || 0);
      if (!emailId) {
        results.push({
          leadContactId,
          success: false,
          error: "Failed to queue email",
          stage: "queue",
        });
        continue;
      }

      if (normalizedAttachments.length > 0) {
        await saveEmailAttachments({
          poolOrConn: pool,
          emailId,
          attachments: normalizedAttachments,
        });
      }

      if (action === "schedule") {
        results.push({ leadContactId, success: true, emailId });
        continue;
      }

      const sendResult = await dispatchQueuedEmailByIdWithDelegated({
        pool,
        emailId,
        accessToken: String(graphSession?.accessToken || ""),
        crmUserId: authUser.userId,
      });

      if (sendResult.sent) {
        results.push({ leadContactId, success: true, emailId });
      } else {
        results.push({
          leadContactId,
          success: false,
          emailId,
          error: sendResult.reason || "Failed to send email",
          stage: "send",
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failedCount = results.length - successCount;

    const response = NextResponse.json(
      {
        success: failedCount === 0,
        message:
          action === "schedule"
            ? `${successCount} email${successCount === 1 ? "" : "s"} scheduled successfully.`
            : failedCount === 0
              ? `Sent ${successCount} email${successCount === 1 ? "" : "s"} successfully.`
              : `Sent ${successCount} email${successCount === 1 ? "" : "s"}; ${failedCount} failed.`,
        action,
        sentCount: action === "send_now" ? successCount : 0,
        scheduledCount: action === "schedule" ? successCount : 0,
        failedCount,
        results,
      },
      { status: failedCount === 0 ? 200 : successCount > 0 ? 207 : 400 }
    );

    if (graphSession?.setCookieHeaders?.length) {
      for (const header of graphSession.setCookieHeaders) {
        response.headers.append("Set-Cookie", header);
      }
    }

    return response;
  } catch (error) {
    console.error("[email-send] Unexpected error", error);
    return NextResponse.json({ error: "Failed to process email request" }, { status: 500 });
  }
}

