import { canUserViewLeadById } from "@/app/api/lib/lead-access";
import { isEmailSuppressed } from "@/app/api/lib/email-suppressions";

export type SequenceStepInput = {
  stepOrder: number;
  templateId: number;
  delayMinutes: number;
};

function toPositiveInt(value: any): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function extractFirstName(contactName: string): string {
  const normalized = String(contactName || "").trim();
  if (!normalized) return "";
  return normalized.split(/\s+/)[0] || "";
}

function renderWithVariables(
  template: string,
  args: { contactName: string; companyName: string }
): string {
  return String(template || "")
    .replace(/{{\s*firstName\s*}}/gi, extractFirstName(args.contactName))
    .replace(/{{\s*companyName\s*}}/gi, args.companyName)
    .replace(/{{\s*contactName\s*}}/gi, args.contactName);
}

export async function ensureSequenceSchema(pool: any): Promise<void> {
  const [cols]: any = await pool.query(`SHOW COLUMNS FROM email_sequence_steps LIKE 'DelayMinutes'`);
  if (!Array.isArray(cols) || cols.length === 0) {
    await pool.query(
      `ALTER TABLE email_sequence_steps ADD COLUMN DelayMinutes int NOT NULL DEFAULT 0 AFTER DelayDays`
    );
  }
}

export async function normalizeSequenceSteps(
  pool: any,
  rawSteps: any[]
): Promise<{ steps: SequenceStepInput[]; error?: string }> {
  const steps = (Array.isArray(rawSteps) ? rawSteps : [])
    .map((step: any, index: number) => ({
      stepOrder: toPositiveInt(step?.stepOrder || index + 1),
      templateId: Number(step?.templateId || 0),
      delayMinutes: toPositiveInt(step?.delayMinutes),
    }))
    .sort((a, b) => a.stepOrder - b.stepOrder)
    .map((step, index) => ({ ...step, stepOrder: index + 1 }));

  if (steps.length === 0) {
    return { steps: [], error: "At least one sequence step is required" };
  }

  if (steps.some((step) => !Number.isInteger(step.templateId) || step.templateId <= 0)) {
    return { steps: [], error: "Each step requires a valid templateId" };
  }

  if (steps.some((step) => step.delayMinutes < 0)) {
    return { steps: [], error: "Delay minutes cannot be negative" };
  }

  const templateIds = Array.from(new Set(steps.map((s) => s.templateId)));
  const [templateRows]: any = await pool.query(
    `SELECT TemplateId FROM email_templates WHERE TemplateId IN (${templateIds.map(() => "?").join(",")})`,
    templateIds
  );
  const existing = new Set((Array.isArray(templateRows) ? templateRows : []).map((row: any) => Number(row.TemplateId)));
  const missing = templateIds.find((id) => !existing.has(id));
  if (missing) {
    return { steps: [], error: `TemplateId ${missing} was not found` };
  }

  return { steps };
}

export async function queueSequenceEmailForStep(args: {
  conn: any;
  sequenceId: number;
  stepId: number;
  leadContactId: number;
  scheduledAtUtc: Date;
  allowNewIfTerminal?: boolean;
}) {
  const { conn, sequenceId, stepId, leadContactId, scheduledAtUtc, allowNewIfTerminal } = args;

  const [existingRows]: any = await conn.query(
    `
      SELECT e.EmailId, e.Status, e.ScheduledAt
      FROM emails e
      INNER JOIN leadcontacts lc
        ON lc.LeadContactID = e.LeadContactID
       AND lc.CompanyId = e.CompanyId
      WHERE e.SequenceId = ?
        AND e.StepId = ?
        AND e.LeadContactID = ?
        AND e.CompanyId IS NOT NULL
      ORDER BY e.EmailId DESC
      LIMIT 1
    `,
    [sequenceId, stepId, leadContactId]
  );

  const existing = Array.isArray(existingRows) && existingRows[0] ? existingRows[0] : null;
  if (existing) {
    const existingStatus = String(existing.Status || "").toUpperCase();
    const terminal = existingStatus === "SENT" || existingStatus === "FAILED";
    if (!allowNewIfTerminal || !terminal) {
      return {
        created: false,
        emailId: Number(existing.EmailId),
        scheduledAt: existing.ScheduledAt ? new Date(existing.ScheduledAt) : scheduledAtUtc,
      };
    }
  }

  const [rows]: any = await conn.query(
    `
      SELECT
        s.StepId,
        s.TemplateId,
        t.Subject,
        t.Body,
        lc.ContactName,
        lc.ContactEmail,
        l.CompanyName,
        COALESCE(s.CompanyId, lc.CompanyId, l.CompanyId) AS CompanyId
      FROM email_sequence_steps s
      LEFT JOIN email_templates t ON t.TemplateId = s.TemplateId
      INNER JOIN leadcontacts lc ON lc.LeadContactID = ?
      INNER JOIN leads l ON l.LeadId = lc.LeadId
      WHERE s.SequenceId = ?
        AND s.StepId = ?
      LIMIT 1
    `,
    [leadContactId, sequenceId, stepId]
  );

  const stepRow = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!stepRow) {
    throw new Error("SEQUENCE_STEP_NOT_FOUND");
  }

  const toEmail = String(stepRow.ContactEmail || "").trim();
  if (!toEmail) {
    throw new Error("RECIPIENT_EMAIL_MISSING");
  }

  const contactName = String(stepRow.ContactName || "").trim();
  const companyName = String(stepRow.CompanyName || "").trim();

  const subject = renderWithVariables(String(stepRow.Subject || ""), {
    contactName,
    companyName,
  });
  const body = renderWithVariables(String(stepRow.Body || ""), {
    contactName,
    companyName,
  });

  const [insertRes]: any = await conn.query(
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, NULL, NULL, NULL)
    `,
    [
      leadContactId,
      Number(stepRow.CompanyId || 0) || null,
      sequenceId,
      stepId,
      Number(stepRow.TemplateId || 0) || null,
      toEmail,
      subject,
      body,
      scheduledAtUtc.toISOString().slice(0, 19).replace("T", " "),
    ]
  );

  return {
    created: true,
    emailId: Number(insertRes?.insertId || 0),
    scheduledAt: scheduledAtUtc,
  };
}

export function evaluateEnrollmentEligibility(input: {
  sequenceStatus?: unknown;
  existingStatus?: unknown;
  reEnroll?: boolean;
  suppressed?: boolean;
}): { allow: boolean; reason?: string; restart?: boolean } {
  if (input.suppressed) {
    return { allow: false, reason: "CONTACT_SUPPRESSED" };
  }

  const sequenceStatus = String(input.sequenceStatus || "").trim().toUpperCase();
  if (sequenceStatus !== "ACTIVE") {
    return { allow: false, reason: "SEQUENCE_NOT_ACTIVE" };
  }

  const existingStatus = String(input.existingStatus || "").trim().toUpperCase();
  if (!existingStatus) {
    return { allow: true, restart: false };
  }
  if (existingStatus === "ACTIVE") {
    return { allow: false, reason: "ALREADY_ACTIVE" };
  }
  if (existingStatus === "PAUSED") {
    return { allow: false, reason: "ALREADY_PAUSED" };
  }
  if (existingStatus === "REMOVED" || existingStatus === "COMPLETED") {
    if (input.reEnroll) {
      return { allow: true, restart: true };
    }
    return { allow: false, reason: "REENROLL_REQUIRED" };
  }
  return { allow: false, reason: "INVALID_ENROLLMENT_STATUS" };
}

export async function enrollContactsInSequence(args: {
  pool: any;
  sequenceId: number;
  leadContactIds: number[];
  authUser: { userId: number; roleId: number; companyId?: number | null };
  reEnroll?: boolean;
}) {
  const { pool, sequenceId, leadContactIds, authUser, reEnroll } = args;

  let conn: any;
  const enrolled: any[] = [];
  const skipped: any[] = [];

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [sequenceRows]: any = await conn.query(
      `SELECT SequenceId, Status FROM email_sequences WHERE SequenceId = ? LIMIT 1 FOR UPDATE`,
      [sequenceId]
    );
    const sequence = Array.isArray(sequenceRows) && sequenceRows[0] ? sequenceRows[0] : null;
    if (!sequence) {
      throw new Error("SEQUENCE_NOT_FOUND");
    }
    if (String(sequence.Status || "").trim().toUpperCase() !== "ACTIVE") {
      throw new Error("SEQUENCE_NOT_ACTIVE");
    }

    const [firstStepRows]: any = await conn.query(
      `
        SELECT StepId, StepOrder
        FROM email_sequence_steps
        WHERE SequenceId = ?
        ORDER BY StepOrder ASC
        LIMIT 1
      `,
      [sequenceId]
    );
    const firstStep = Array.isArray(firstStepRows) && firstStepRows[0] ? firstStepRows[0] : null;
    if (!firstStep) {
      throw new Error("SEQUENCE_HAS_NO_STEPS");
    }

    for (const leadContactId of leadContactIds) {
      const [contactRows]: any = await conn.query(
        `
          SELECT lc.LeadContactID, lc.LeadId, lc.ContactEmail, lc.CompanyId
          FROM leadcontacts lc
          WHERE lc.LeadContactID = ?
          LIMIT 1
        `,
        [leadContactId]
      );
      const contact = Array.isArray(contactRows) && contactRows[0] ? contactRows[0] : null;
      if (!contact) {
        skipped.push({ leadContactId, reason: "CONTACT_NOT_FOUND" });
        continue;
      }

      const canAccess = await canUserViewLeadById(conn, authUser, Number(contact.LeadId || 0));
      if (!canAccess) {
        skipped.push({ leadContactId, reason: "ACCESS_DENIED" });
        continue;
      }

      if (!String(contact.ContactEmail || "").trim()) {
        skipped.push({ leadContactId, reason: "CONTACT_EMAIL_MISSING" });
        continue;
      }

      const contactCompanyId = Number(contact.CompanyId);
      if (!(contactCompanyId > 0)) {
        skipped.push({ leadContactId, reason: "CONTACT_COMPANY_MISSING" });
        continue;
      }
      const suppressed = await isEmailSuppressed(conn, contact.ContactEmail, contactCompanyId);
      if (suppressed) {
        skipped.push({ leadContactId, reason: "CONTACT_SUPPRESSED" });
        continue;
      }

      const [existingRows]: any = await conn.query(
        `
          SELECT SequenceContactId, Status
          FROM email_sequence_contacts
          WHERE SequenceId = ?
            AND LeadContactID = ?
          LIMIT 1
        `,
        [sequenceId, leadContactId]
      );
      const existing = Array.isArray(existingRows) && existingRows[0] ? existingRows[0] : null;

      const eligibility = evaluateEnrollmentEligibility({
        sequenceStatus: sequence.Status,
        existingStatus: existing?.Status,
        reEnroll,
      });
      if (!eligibility.allow) {
        skipped.push({ leadContactId, reason: eligibility.reason || "NOT_ELIGIBLE" });
        continue;
      }

      if (existing) {
        await conn.query(
          `
            UPDATE email_sequence_contacts
            SET Status = 'ACTIVE',
                CurrentStep = 1,
                NextActionAt = UTC_TIMESTAMP(),
                StartedAt = COALESCE(StartedAt, UTC_TIMESTAMP()),
                CompletedAt = NULL
            WHERE SequenceContactId = ?
          `,
          [existing.SequenceContactId]
        );
      } else {
        await conn.query(
          `
            INSERT INTO email_sequence_contacts (
              SequenceId,
              CompanyId,
              LeadContactID,
              CurrentStep,
              Status,
              NextActionAt,
              StartedAt,
              CompletedAt
            )
            VALUES (?, ?, ?, 1, 'ACTIVE', UTC_TIMESTAMP(), UTC_TIMESTAMP(), NULL)
          `,
          [sequenceId, Number(contact.CompanyId || 0) || null, leadContactId]
        );
      }

      const now = new Date();
      const queued = await queueSequenceEmailForStep({
        conn,
        sequenceId,
        stepId: Number(firstStep.StepId),
        leadContactId,
        scheduledAtUtc: now,
        allowNewIfTerminal: Boolean(eligibility.restart),
      });

      await conn.query(
        `
          UPDATE email_sequence_contacts
          SET NextActionAt = ?,
              CurrentStep = 1,
              Status = 'ACTIVE'
          WHERE SequenceId = ?
            AND LeadContactID = ?
        `,
        [
          queued.scheduledAt.toISOString().slice(0, 19).replace("T", " "),
          sequenceId,
          leadContactId,
        ]
      );

      enrolled.push({ leadContactId, emailId: queued.emailId, created: queued.created });
    }

    await conn.commit();
    return { enrolled, skipped };
  } catch (error) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {
        // ignore
      }
    }
    throw error;
  } finally {
    if (conn) conn.release();
  }
}

export async function advanceSequenceAfterEmailSent(args: {
  conn: any;
  emailId: number;
}): Promise<void> {
  const { conn, emailId } = args;

  await ensureSequenceSchema(conn);

  const [rows]: any = await conn.query(
    `
      SELECT
        e.EmailId,
        e.SequenceId,
        e.StepId,
        e.LeadContactID,
        e.CompanyId,
        e.SentAt,
        s.StepOrder,
        seq.Status AS SequenceStatus
      FROM emails e
      LEFT JOIN email_sequence_steps s ON s.StepId = e.StepId
      LEFT JOIN email_sequences seq ON seq.SequenceId = e.SequenceId
      WHERE e.EmailId = ?
        AND e.CompanyId IS NOT NULL
      LIMIT 1
    `,
    [emailId]
  );

  const sent = Array.isArray(rows) && rows[0] ? rows[0] : null;
  const sequenceId = Number(sent?.SequenceId || 0);
  const stepId = Number(sent?.StepId || 0);
  const leadContactId = Number(sent?.LeadContactID || 0);
  const currentStepOrder = Number(sent?.StepOrder || 0);
  const sequenceStatus = String(sent?.SequenceStatus || "").toUpperCase();

  if (!sequenceId || !stepId || !leadContactId || !currentStepOrder) {
    return;
  }

  const [contactRows]: any = await conn.query(
    `
      SELECT SequenceContactId
      FROM email_sequence_contacts
      WHERE SequenceId = ?
        AND LeadContactID = ?
      LIMIT 1
      FOR UPDATE
    `,
    [sequenceId, leadContactId]
  );

  const sequenceContact = Array.isArray(contactRows) && contactRows[0] ? contactRows[0] : null;
  if (!sequenceContact) {
    return;
  }

  const [nextStepRows]: any = await conn.query(
    `
      SELECT
        StepId,
        StepOrder,
        COALESCE(DelayMinutes, DelayDays * 1440, 0) AS EffectiveDelayMinutes
      FROM email_sequence_steps
      WHERE SequenceId = ?
        AND StepOrder > ?
      ORDER BY StepOrder ASC
      LIMIT 1
    `,
    [sequenceId, currentStepOrder]
  );

  const nextStep = Array.isArray(nextStepRows) && nextStepRows[0] ? nextStepRows[0] : null;

  if (!nextStep) {
    await conn.query(
      `
        UPDATE email_sequence_contacts
        SET Status = 'COMPLETED',
            CurrentStep = ?,
            NextActionAt = NULL,
            CompletedAt = COALESCE(CompletedAt, UTC_TIMESTAMP())
        WHERE SequenceContactId = ?
      `,
      [currentStepOrder, sequenceContact.SequenceContactId]
    );
    console.log(
      `[Email Sequence] Sequence completed for LeadContactID: ${leadContactId} (SequenceId: ${sequenceId})`
    );
    return;
  }

  if (sequenceStatus !== "ACTIVE") {
    await conn.query(
      `
        UPDATE email_sequence_contacts
        SET Status = 'PAUSED',
            CurrentStep = ?,
            NextActionAt = NULL
        WHERE SequenceContactId = ?
      `,
      [Number(nextStep.StepOrder), sequenceContact.SequenceContactId]
    );
    return;
  }

  const sentAtDate = sent?.SentAt ? new Date(sent.SentAt) : new Date();
  const delayMinutes = toPositiveInt(nextStep.EffectiveDelayMinutes);
  const nextScheduledAt = new Date(sentAtDate.getTime() + delayMinutes * 60 * 1000);

  console.log(
    `[Email Sequence] Processing SequenceId: ${sequenceId}, LeadContactID: ${leadContactId}, Current Step: ${currentStepOrder}, Next Step: ${Number(
      nextStep.StepOrder
    )}, ScheduledAt: ${nextScheduledAt.toISOString()}`
  );

  const queued = await queueSequenceEmailForStep({
    conn,
    sequenceId,
    stepId: Number(nextStep.StepId),
    leadContactId,
    scheduledAtUtc: nextScheduledAt,
  });

  await conn.query(
    `
      UPDATE email_sequence_contacts
      SET Status = 'ACTIVE',
          CurrentStep = ?,
          NextActionAt = ?
      WHERE SequenceContactId = ?
    `,
    [
      Number(nextStep.StepOrder),
      queued.scheduledAt.toISOString().slice(0, 19).replace("T", " "),
      sequenceContact.SequenceContactId,
    ]
  );

  if (queued.created) {
    console.log(
      `[Email Sequence] Created follow-up EmailId: ${queued.emailId}, StepId: ${Number(
        nextStep.StepId
      )}, ScheduledAt: ${queued.scheduledAt.toISOString()}`
    );
  }
}

export type SequenceDispatchEligibility = {
  eligible: boolean;
  reason?: string;
};

export type ClaimedDispatchEmail = {
  EmailId: number;
  LeadContactID: number;
  SequenceId: number | null;
  StepId: number | null;
  ToEmail: string;
  Subject: string;
  Body: string;
  CompanyId: number;
};

export type ClaimDueQueuedEmailResult =
  | { skipped: true; reason: string; row?: undefined }
  | { skipped: false; reason?: undefined; row: ClaimedDispatchEmail };

function toSequenceId(value: unknown): number {
  const n = Number(value || 0);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export function evaluateSequenceDispatchEligibility(input: {
  sequenceId?: unknown;
  sequenceStatus?: unknown;
  enrollmentStatus?: unknown;
}): SequenceDispatchEligibility {
  const sequenceId = toSequenceId(input.sequenceId);
  if (!sequenceId) {
    return { eligible: true };
  }

  const sequenceStatus = String(input.sequenceStatus || "").trim().toUpperCase();
  const enrollmentStatus = String(input.enrollmentStatus || "").trim().toUpperCase();

  if (sequenceStatus !== "ACTIVE") {
    return { eligible: false, reason: "SEQUENCE_NOT_ACTIVE" };
  }

  if (!enrollmentStatus) {
    return { eligible: false, reason: "ENROLLMENT_NOT_FOUND" };
  }

  if (enrollmentStatus !== "ACTIVE") {
    return { eligible: false, reason: "ENROLLMENT_NOT_ACTIVE" };
  }

  return { eligible: true };
}

export async function pauseActiveSequenceEnrollments(conn: any, sequenceId: number): Promise<void> {
  await conn.query(
    `
      UPDATE email_sequence_contacts
      SET Status = 'PAUSED',
          NextActionAt = NULL
      WHERE SequenceId = ?
        AND UPPER(Status) = 'ACTIVE'
    `,
    [sequenceId]
  );
}

export async function claimDueQueuedEmailForDispatch(args: {
  pool: any;
  emailId: number;
  requireScheduledAt: boolean;
}): Promise<ClaimDueQueuedEmailResult> {
  const { pool, emailId, requireScheduledAt } = args;
  let conn: any;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [rows]: any = await conn.query(
      `
        SELECT
          e.EmailId,
          e.LeadContactID,
          e.SequenceId,
          e.StepId,
          e.ToEmail,
          e.Subject,
          e.Body,
          e.CompanyId,
          e.Status AS EmailStatus,
          s.Status AS SequenceStatus,
          esc.Status AS EnrollmentStatus,
          lc.CompanyId AS ContactCompanyId,
          l.CompanyId AS LeadCompanyId
        FROM emails e
        INNER JOIN leadcontacts lc
          ON lc.LeadContactID = e.LeadContactID
         AND lc.CompanyId = e.CompanyId
        INNER JOIN leads l
          ON l.LeadId = lc.LeadId
         AND l.CompanyId = e.CompanyId
        LEFT JOIN email_sequences s
          ON s.SequenceId = e.SequenceId
        LEFT JOIN email_sequence_contacts esc
          ON esc.SequenceId = e.SequenceId
         AND esc.LeadContactID = e.LeadContactID
        WHERE e.EmailId = ?
          AND e.CompanyId IS NOT NULL
        LIMIT 1
        FOR UPDATE
      `,
      [emailId]
    );

    const locked = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (!locked) {
      await conn.rollback();
      return { skipped: true, reason: "EMAIL_ROW_NOT_FOUND" };
    }

    if (String(locked.EmailStatus || "").toUpperCase() !== "QUEUED") {
      await conn.rollback();
      return { skipped: true, reason: "NOT_DUE_OR_ALREADY_PROCESSED" };
    }

    const emailCompanyId = Number(locked.CompanyId);
    const contactCompanyId = Number(locked.ContactCompanyId);
    const leadCompanyId = Number(locked.LeadCompanyId);
    if (
      !(emailCompanyId > 0) ||
      emailCompanyId !== contactCompanyId ||
      emailCompanyId !== leadCompanyId
    ) {
      await conn.rollback();
      return { skipped: true, reason: "COMPANY_MISMATCH" };
    }

    const eligibility = evaluateSequenceDispatchEligibility({
      sequenceId: locked.SequenceId,
      sequenceStatus: locked.SequenceStatus,
      enrollmentStatus: locked.EnrollmentStatus,
    });

    if (!eligibility.eligible) {
      await conn.rollback();
      return { skipped: true, reason: eligibility.reason || "SEQUENCE_NOT_ELIGIBLE" };
    }

    const duePredicate = requireScheduledAt
      ? "ScheduledAt IS NOT NULL AND ScheduledAt <= UTC_TIMESTAMP()"
      : "(ScheduledAt IS NULL OR ScheduledAt <= UTC_TIMESTAMP())";

    const [claimResult]: any = await conn.query(
      `
        UPDATE emails
        SET Status = 'SENDING'
        WHERE EmailId = ?
          AND CompanyId = ?
          AND Status = 'QUEUED'
          AND ${duePredicate}
      `,
      [emailId, emailCompanyId]
    );

    if (!Number(claimResult?.affectedRows || 0)) {
      await conn.rollback();
      return { skipped: true, reason: "NOT_DUE_OR_ALREADY_PROCESSED" };
    }

    await conn.commit();

    return {
      skipped: false,
      row: {
        EmailId: Number(locked.EmailId),
        LeadContactID: Number(locked.LeadContactID || 0),
        SequenceId: toSequenceId(locked.SequenceId) || null,
        StepId: Number(locked.StepId || 0) || null,
        ToEmail: String(locked.ToEmail || ""),
        Subject: String(locked.Subject || ""),
        Body: String(locked.Body || ""),
        CompanyId: emailCompanyId,
      },
    };
  } catch (error) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {
        // ignore rollback errors
      }
    }
    throw error;
  } finally {
    if (conn) conn.release();
  }
}

export async function releaseClaimedSequenceEmailIfIneligible(args: {
  pool: any;
  emailId: number;
  sequenceId: number | null;
  leadContactId: number;
  companyId?: number | null;
}): Promise<SequenceDispatchEligibility> {
  const sequenceId = toSequenceId(args.sequenceId);
  if (!sequenceId) {
    return { eligible: true };
  }

  const [rows]: any = await args.pool.query(
    `
      SELECT
        s.Status AS SequenceStatus,
        esc.Status AS EnrollmentStatus
      FROM email_sequences s
      LEFT JOIN email_sequence_contacts esc
        ON esc.SequenceId = s.SequenceId
       AND esc.LeadContactID = ?
      WHERE s.SequenceId = ?
      LIMIT 1
    `,
    [args.leadContactId, sequenceId]
  );

  const current = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  const eligibility = evaluateSequenceDispatchEligibility({
    sequenceId,
    sequenceStatus: current?.SequenceStatus,
    enrollmentStatus: current?.EnrollmentStatus,
  });

  if (eligibility.eligible) {
    return eligibility;
  }

  const companyId = Number(args.companyId);
  await args.pool.query(
    `
      UPDATE emails
      SET Status = 'QUEUED'
      WHERE EmailId = ?
        AND Status = 'SENDING'
        ${companyId > 0 ? "AND CompanyId = ?" : "AND CompanyId IS NOT NULL"}
    `,
    companyId > 0 ? [args.emailId, companyId] : [args.emailId]
  );

  return eligibility;
}

export type EnrollmentAction = "pause" | "resume" | "remove";

export type EnrollmentActionResult = {
  sequenceContactId: number;
  sequenceId: number;
  leadContactId: number;
  status: string;
  currentStep: number;
  nextActionAt: Date | string | null;
  pendingQueuedEmail: boolean;
  queuedEmailId: number | null;
  warning?: string;
};

function normalizeEnrollmentStatus(value: unknown): string {
  return String(value || "").trim().toUpperCase();
}

export function evaluateEnrollmentActionTransition(input: {
  action: EnrollmentAction;
  enrollmentStatus: unknown;
  sequenceStatus: unknown;
}): { ok: true; nextStatus: string } | { ok: false; reason: string } {
  const action = input.action;
  const enrollmentStatus = normalizeEnrollmentStatus(input.enrollmentStatus);
  const sequenceStatus = normalizeEnrollmentStatus(input.sequenceStatus);

  if (action === "pause") {
    if (enrollmentStatus !== "ACTIVE") {
      return { ok: false, reason: "INVALID_TRANSITION" };
    }
    return { ok: true, nextStatus: "PAUSED" };
  }

  if (action === "resume") {
    if (enrollmentStatus !== "PAUSED") {
      return { ok: false, reason: "INVALID_TRANSITION" };
    }
    if (sequenceStatus !== "ACTIVE") {
      return { ok: false, reason: "SEQUENCE_NOT_ACTIVE" };
    }
    return { ok: true, nextStatus: "ACTIVE" };
  }

  if (action === "remove") {
    if (enrollmentStatus === "REMOVED") {
      return { ok: false, reason: "INVALID_TRANSITION" };
    }
    return { ok: true, nextStatus: "REMOVED" };
  }

  return { ok: false, reason: "INVALID_ACTION" };
}

export async function applySequenceEnrollmentAction(args: {
  pool: any;
  sequenceId: number;
  sequenceContactId: number;
  action: EnrollmentAction;
  authUser: { userId: number; roleId: number; companyId?: number | null };
}): Promise<EnrollmentActionResult> {
  const { pool, sequenceId, sequenceContactId, action, authUser } = args;
  let conn: any;

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [rows]: any = await conn.query(
      `
        SELECT
          esc.SequenceContactId,
          esc.SequenceId,
          esc.LeadContactID,
          esc.CurrentStep,
          esc.Status,
          esc.NextActionAt,
          s.Status AS SequenceStatus,
          lc.LeadId,
          lc.CompanyId AS ContactCompanyId
        FROM email_sequence_contacts esc
        INNER JOIN email_sequences s
          ON s.SequenceId = esc.SequenceId
        INNER JOIN leadcontacts lc
          ON lc.LeadContactID = esc.LeadContactID
        WHERE esc.SequenceContactId = ?
          AND esc.SequenceId = ?
        LIMIT 1
        FOR UPDATE
      `,
      [sequenceContactId, sequenceId]
    );

    const locked = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (!locked) {
      await conn.rollback();
      throw new Error("ENROLLMENT_NOT_FOUND");
    }

    const canAccess = await canUserViewLeadById(conn, authUser, Number(locked.LeadId || 0));
    if (!canAccess) {
      await conn.rollback();
      throw new Error("ACCESS_DENIED");
    }

    const transition = evaluateEnrollmentActionTransition({
      action,
      enrollmentStatus: locked.Status,
      sequenceStatus: locked.SequenceStatus,
    });

    if (!transition.ok) {
      await conn.rollback();
      throw new Error(transition.reason);
    }

    let updateSql = "";
    if (action === "pause") {
      updateSql = `
          UPDATE email_sequence_contacts
          SET Status = 'PAUSED'
          WHERE SequenceContactId = ?
            AND SequenceId = ?
            AND UPPER(Status) = 'ACTIVE'
      `;
    } else if (action === "resume") {
      updateSql = `
          UPDATE email_sequence_contacts
          SET Status = 'ACTIVE'
          WHERE SequenceContactId = ?
            AND SequenceId = ?
            AND UPPER(Status) = 'PAUSED'
      `;
    } else {
      updateSql = `
          UPDATE email_sequence_contacts
          SET Status = 'REMOVED',
              NextActionAt = NULL
          WHERE SequenceContactId = ?
            AND SequenceId = ?
            AND UPPER(Status) <> 'REMOVED'
      `;
    }

    const [updateResult]: any = await conn.query(updateSql, [sequenceContactId, sequenceId]);
    if (!Number(updateResult?.affectedRows || 0)) {
      await conn.rollback();
      throw new Error("INVALID_TRANSITION");
    }

    const [queuedRows]: any = await conn.query(
      `
        SELECT EmailId, Status
        FROM emails
        WHERE SequenceId = ?
          AND LeadContactID = ?
          AND CompanyId = ?
          AND UPPER(Status) = 'QUEUED'
        ORDER BY EmailId DESC
        LIMIT 1
      `,
      [sequenceId, Number(locked.LeadContactID), Number(locked.ContactCompanyId)]
    );
    const queued = Array.isArray(queuedRows) && queuedRows[0] ? queuedRows[0] : null;

    const [updatedRows]: any = await conn.query(
      `
        SELECT SequenceContactId, SequenceId, LeadContactID, CurrentStep, Status, NextActionAt
        FROM email_sequence_contacts
        WHERE SequenceContactId = ?
        LIMIT 1
      `,
      [sequenceContactId]
    );
    const updated = Array.isArray(updatedRows) && updatedRows[0] ? updatedRows[0] : null;
    if (!updated) {
      await conn.rollback();
      throw new Error("ENROLLMENT_NOT_FOUND");
    }

    await conn.commit();

    const pendingQueuedEmail = Boolean(queued);
    const warning =
      action === "resume" && !pendingQueuedEmail
        ? "No queued email is pending for this enrollment. The current step was not restarted or duplicated."
        : undefined;

    return {
      sequenceContactId: Number(updated.SequenceContactId),
      sequenceId: Number(updated.SequenceId),
      leadContactId: Number(updated.LeadContactID),
      status: String(updated.Status || ""),
      currentStep: Number(updated.CurrentStep || 0),
      nextActionAt: updated.NextActionAt ?? null,
      pendingQueuedEmail,
      queuedEmailId: queued ? Number(queued.EmailId) : null,
      warning,
    };
  } catch (error) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {
        // ignore rollback errors
      }
    }
    throw error;
  } finally {
    if (conn) conn.release();
  }
}

