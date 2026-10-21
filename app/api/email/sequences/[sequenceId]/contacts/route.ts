import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import { getAuthUser } from "@/app/api/lib/auth";
import { CompanyRequiredError, requireCompanyId } from "@/app/api/lib/company-tenancy";
import {
  buildLeadOwnerVisibilityClause,
} from "@/app/api/lib/lead-access";
import { ensureSequenceSchema } from "@/app/api/lib/email-sequences";

function parseSequenceId(raw: string): number | null {
  const id = Number(raw || 0);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

export async function GET(
  req: NextRequest,
  context: { params: { sequenceId: string } }
) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const sequenceId = parseSequenceId(context.params.sequenceId);
    if (!sequenceId) {
      return NextResponse.json({ error: "Invalid sequence id" }, { status: 400 });
    }

    const companyId = requireCompanyId(authUser);
    const pool = await getPool();
    await ensureSequenceSchema(pool);

    const visibility = buildLeadOwnerVisibilityClause(authUser, "l");

    const [rows]: any = await pool.query(
      `
        SELECT
          esc.SequenceContactId,
          esc.SequenceId,
          esc.LeadContactID,
          esc.CurrentStep,
          esc.Status,
          esc.NextActionAt,
          esc.StartedAt,
          esc.CompletedAt,
          esc.CreatedAt,
          esc.UpdatedAt,
          lc.ContactName,
          lc.ContactEmail,
          l.LeadId,
          l.CompanyName,
          currentStep.StepId AS CurrentStepId,
          currentStep.TemplateId AS CurrentTemplateId,
          ct.TemplateName AS CurrentTemplateName,
          latest.EmailId AS LastEmailId,
          latest.StepId AS LastStepId,
          latest.Status AS LastEmailStatus,
          latest.SentAt AS LastEmailSentAt,
          nextStep.StepId AS NextStepId,
          nextStep.StepOrder AS NextStepOrder,
          nt.TemplateName AS NextTemplateName
        FROM email_sequence_contacts esc
        INNER JOIN leadcontacts lc ON lc.LeadContactID = esc.LeadContactID
        INNER JOIN leads l ON l.LeadId = lc.LeadId
        LEFT JOIN email_sequence_steps currentStep
          ON currentStep.SequenceId = esc.SequenceId
         AND currentStep.StepOrder = esc.CurrentStep
        LEFT JOIN email_templates ct ON ct.TemplateId = currentStep.TemplateId
        LEFT JOIN (
          SELECT e1.*
          FROM emails e1
          INNER JOIN (
            SELECT LeadContactID, SequenceId, MAX(EmailId) AS MaxEmailId
            FROM emails
            WHERE SequenceId = ?
              AND CompanyId = ?
            GROUP BY LeadContactID, SequenceId
          ) mx
            ON mx.MaxEmailId = e1.EmailId
        ) latest
          ON latest.SequenceId = esc.SequenceId
         AND latest.LeadContactID = esc.LeadContactID
        LEFT JOIN email_sequence_steps nextStep
          ON nextStep.SequenceId = esc.SequenceId
         AND nextStep.StepOrder = esc.CurrentStep
        LEFT JOIN email_templates nt ON nt.TemplateId = nextStep.TemplateId
        WHERE esc.SequenceId = ?
          AND l.CompanyId = ?
          AND ${visibility.clause}
        ORDER BY esc.UpdatedAt DESC, esc.SequenceContactId DESC
      `,
      [sequenceId, companyId, sequenceId, companyId, ...visibility.params]
    );

    return NextResponse.json(Array.isArray(rows) ? rows : []);
  } catch (error) {
    console.error("[email-sequence-contacts] GET error", error);
    if (error instanceof CompanyRequiredError) {
      return NextResponse.json({ error: "Company membership required" }, { status: 403 });
    }
    return NextResponse.json({ error: "Failed to fetch sequence contacts" }, { status: 500 });
  }
}

