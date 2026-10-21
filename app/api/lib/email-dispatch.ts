import { timingSafeEqual } from "crypto";
import {
  GraphMailSendError,
  sendMailWithApplicationGraph,
  sendMailWithDelegatedGraphToken,
  type GraphSentMessageIds,
} from "@/app/api/lib/graph-mail";
import {
  advanceSequenceAfterEmailSent,
  claimDueQueuedEmailForDispatch,
  releaseClaimedSequenceEmailIfIneligible,
} from "@/app/api/lib/email-sequences";
import { getEmailAttachments, mapToGraphFileAttachments } from "@/app/api/lib/email-attachments";
import { insertEmailEventForEmail } from "@/app/api/lib/email-events-write";
import { blockDispatchIfSuppressed, buildSendableHtmlWithUnsubscribe } from "@/app/api/lib/email-suppressions";
import { applyOptionalEmailTracking } from "@/app/api/lib/email-tracking";

export const EMAIL_DISPATCH_TOKEN_HEADER = "x-email-dispatch-token";
export const SEND_ATTEMPT_EVENT = "SEND_ATTEMPT";

function tokensMatch(expected: string, incoming: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(incoming);
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Trusted scheduler/webhook auth. A valid shared token is sufficient; do not
 * require an interactive CompanyUsers membership. Tenant isolation is enforced
 * by deriving CompanyId from the stored email row and scoping mutations to it.
 */
export function authorizeEmailDispatchRequest(headerToken: string | null | undefined): {
  ok: boolean;
  status?: number;
  error?: string;
} {
  const configured = String(process.env.EMAIL_DISPATCH_TOKEN || "").trim();
  if (!configured) {
    return { ok: false, status: 503, error: "Email dispatch is not configured" };
  }
  const incoming = String(headerToken || "").trim();
  if (!tokensMatch(configured, incoming)) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  return { ok: true };
}

export function getSendingStaleSeconds(): number {
  const raw = Number(process.env.EMAIL_SENDING_STALE_SECONDS || 900);
  if (!Number.isFinite(raw)) return 900;
  return Math.max(60, Math.min(86_400, Math.floor(raw)));
}

export function safeSendFailureMessage(err: unknown): string {
  if (err instanceof GraphMailSendError) return err.safeMessage;
  return "SEND_FAILED";
}

export async function persistSentEmailAfterGraphSuccess(args: {
  poolOrConn: any;
  emailId: number;
  source: string;
  sequenceId?: number | null;
  stepId?: number | null;
  crmUserId?: number | null;
  sentIds?: GraphSentMessageIds | null;
  companyId?: number | null;
}): Promise<{ persisted: boolean }> {
  let companyId = Number(args.companyId);
  if (!(companyId > 0)) {
    const [companyRows]: any = await args.poolOrConn.query(
      `SELECT CompanyId FROM emails WHERE EmailId = ? AND CompanyId IS NOT NULL LIMIT 1`,
      [args.emailId]
    );
    companyId = Number(companyRows?.[0]?.CompanyId);
  }
  if (!(companyId > 0)) {
    return { persisted: false };
  }

  const [updateResult]: any = await args.poolOrConn.query(
    `
      UPDATE emails
      SET Status = 'SENT',
          SentAt = COALESCE(SentAt, UTC_TIMESTAMP()),
          ProviderMessageId = COALESCE(?, ProviderMessageId),
          ThreadId = COALESCE(?, ThreadId)
      WHERE EmailId = ?
        AND CompanyId = ?
        AND Status = 'SENDING'
    `,
    [
      args.sentIds?.internetMessageId ?? null,
      args.sentIds?.conversationId ?? null,
      args.emailId,
      companyId,
    ]
  );

  await insertEmailEventForEmail({
    poolOrConn: args.poolOrConn,
    emailId: args.emailId,
    eventType: "SENT",
    uniqueByEventType: true,
    metadata: {
      source: args.source,
      crmUserId: args.crmUserId ?? null,
      sequenceId: args.sequenceId ?? null,
      stepId: args.stepId ?? null,
      graphMessageId: args.sentIds?.graphMessageId ?? null,
      conversationId: args.sentIds?.conversationId ?? null,
      internetMessageId: args.sentIds?.internetMessageId ?? null,
    },
  });

  return { persisted: Number(updateResult?.affectedRows || 0) > 0 };
}

export async function recordGraphSendAttempt(args: {
  pool: any;
  emailId: number;
  source: string;
  sequenceId?: number | null;
  stepId?: number | null;
}): Promise<void> {
  await insertEmailEventForEmail({
    poolOrConn: args.pool,
    emailId: args.emailId,
    eventType: SEND_ATTEMPT_EVENT,
    uniqueByEventType: true,
    metadata: {
      source: args.source,
      sequenceId: args.sequenceId ?? null,
      stepId: args.stepId ?? null,
    },
  });
}

export async function recoverStaleSendingEmails(args: {
  pool: any;
  staleSeconds?: number;
  limit?: number;
}): Promise<{
  recoveredQueued: number;
  markedUncertain: number;
  emailIds: Array<{ emailId: number; outcome: "queued" | "uncertain" }>;
}> {
  const staleSeconds = args.staleSeconds ?? getSendingStaleSeconds();
  const limit = Math.min(200, Math.max(1, Number(args.limit || 25)));
  const emailIds: Array<{ emailId: number; outcome: "queued" | "uncertain" }> = [];
  let recoveredQueued = 0;
  let markedUncertain = 0;

  const [rows]: any = await args.pool.query(
    `
      SELECT e.EmailId, e.CompanyId
      FROM emails e
      INNER JOIN leadcontacts lc
        ON lc.LeadContactID = e.LeadContactID
       AND lc.CompanyId = e.CompanyId
      INNER JOIN leads l
        ON l.LeadId = lc.LeadId
       AND l.CompanyId = e.CompanyId
      WHERE e.Status = 'SENDING'
        AND e.CompanyId IS NOT NULL
        AND e.UpdatedAt IS NOT NULL
        AND e.UpdatedAt <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? SECOND)
      ORDER BY e.UpdatedAt ASC, e.EmailId ASC
      LIMIT ?
    `,
    [staleSeconds, limit]
  );

  for (const row of Array.isArray(rows) ? rows : []) {
    const emailId = Number(row?.EmailId || 0);
    const companyId = Number(row?.CompanyId || 0);
    if (!emailId || !(companyId > 0)) continue;

    const [attemptRows]: any = await args.pool.query(
      `
        SELECT EventId
        FROM email_events
        WHERE EmailId = ?
          AND CompanyId = ?
          AND EventType = ?
        LIMIT 1
      `,
      [emailId, companyId, SEND_ATTEMPT_EVENT]
    );
    const hasAttempt = Array.isArray(attemptRows) && attemptRows.length > 0;

    if (!hasAttempt) {
      const [updateResult]: any = await args.pool.query(
        `
          UPDATE emails
          SET Status = 'QUEUED'
          WHERE EmailId = ?
            AND CompanyId = ?
            AND Status = 'SENDING'
        `,
        [emailId, companyId]
      );
      if (Number(updateResult?.affectedRows || 0)) {
        recoveredQueued += 1;
        emailIds.push({ emailId, outcome: "queued" });
      }
      continue;
    }

    const [failResult]: any = await args.pool.query(
      `
        UPDATE emails
        SET Status = 'FAILED'
        WHERE EmailId = ?
          AND CompanyId = ?
          AND Status = 'SENDING'
      `,
      [emailId, companyId]
    );
    if (!Number(failResult?.affectedRows || 0)) continue;

    await insertEmailEventForEmail({
      poolOrConn: args.pool,
      emailId,
      eventType: "FAILED",
      metadata: {
        source: "stale-sending-recovery",
        reason: "SEND_OUTCOME_UNCERTAIN",
      },
    });
    markedUncertain += 1;
    emailIds.push({ emailId, outcome: "uncertain" });
  }

  return { recoveredQueued, markedUncertain, emailIds };
}

type DispatchResult = {
  emailId: number;
  sent: boolean;
  skipped: boolean;
  reason?: string;
};

function parseEmailId(raw: any): number {
  const parsed = Number(raw || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export async function dispatchQueuedEmailByIdWithDelegated(args: {
  pool: any;
  emailId: number;
  accessToken: string;
  crmUserId?: number | null;
}): Promise<DispatchResult> {
  const { pool, emailId, accessToken, crmUserId } = args;
  let claimedCompanyId: number | null = null;

  try {
    const claimed = await claimDueQueuedEmailForDispatch({
      pool,
      emailId,
      requireScheduledAt: false,
    });

    if (claimed.skipped || !claimed.row) {
      return { emailId, sent: false, skipped: true, reason: claimed.reason };
    }

    const row = claimed.row;
    claimedCompanyId = row.CompanyId;

    console.log(`[Email Scheduler] Sending EmailId: ${emailId}`);

    const attachments = await getEmailAttachments({
      poolOrConn: pool,
      emailId,
      companyId: row.CompanyId,
      includeContent: true,
    });

    const stillEligible = await releaseClaimedSequenceEmailIfIneligible({
      pool,
      emailId,
      sequenceId: row.SequenceId,
      leadContactId: row.LeadContactID,
      companyId: row.CompanyId,
    });
    if (!stillEligible.eligible) {
      return {
        emailId,
        sent: false,
        skipped: true,
        reason: stillEligible.reason || "SEQUENCE_NOT_ELIGIBLE",
      };
    }

    const suppressed = await blockDispatchIfSuppressed({
      pool,
      emailId,
      toEmail: String(row.ToEmail || ""),
      sequenceId: row.SequenceId,
      leadContactId: row.LeadContactID,
    });
    if (suppressed.blocked) {
      return {
        emailId,
        sent: false,
        skipped: true,
        reason: suppressed.reason || "RECIPIENT_SUPPRESSED",
      };
    }

    await recordGraphSendAttempt({
      pool,
      emailId,
      source: "graph-delegated",
      sequenceId: row.SequenceId,
      stepId: row.StepId,
    });

    await sendMailWithDelegatedGraphToken({
      accessToken,
      to: String(row.ToEmail || ""),
      subject: String(row.Subject || ""),
      htmlBody: await applyOptionalEmailTracking({
        pool,
        html: buildSendableHtmlWithUnsubscribe({
          body: String(row.Body || ""),
          inlineContentIds: attachments
            .filter((att) => att.isInline && att.contentId)
            .map((att) => String(att.contentId || "")),
          emailId,
          toEmail: String(row.ToEmail || ""),
        }),
        emailId,
        toEmail: String(row.ToEmail || ""),
      }),
      attachments: mapToGraphFileAttachments(attachments),
    });

    let finalizeConn: any;
    try {
      finalizeConn = await pool.getConnection();
      await finalizeConn.beginTransaction();

      await insertEmailEventForEmail({
        poolOrConn: finalizeConn,
        emailId,
        eventType: "SENT",
        uniqueByEventType: true,
        metadata: {
          source: "graph-delegated",
          crmUserId: crmUserId ?? null,
          sequenceId: row.SequenceId ? Number(row.SequenceId) : null,
          stepId: row.StepId ? Number(row.StepId) : null,
        },
      });

      await finalizeConn.query(
        `
          UPDATE emails
          SET Status = 'SENT',
              SentAt = UTC_TIMESTAMP()
          WHERE EmailId = ?
            AND CompanyId = ?
        `,
        [emailId, row.CompanyId]
      );

      await finalizeConn.query(
        `
          UPDATE leadcontacts lc
          INNER JOIN emails e
            ON e.LeadContactID = lc.LeadContactID
           AND e.CompanyId = lc.CompanyId
          SET lc.EmailSent = 1
          WHERE e.EmailId = ?
            AND e.CompanyId = ?
        `,
        [emailId, row.CompanyId]
      );

      if (Number(row.SequenceId || 0) > 0 && Number(row.StepId || 0) > 0) {
        try {
          await advanceSequenceAfterEmailSent({
            conn: finalizeConn,
            emailId,
          });
        } catch (sequenceError) {
          console.error(
            `[Email Sequence] Failed to advance after delegated send for EmailId: ${emailId}`,
            sequenceError
          );
        }
      }

      await finalizeConn.commit();
      return { emailId, sent: true, skipped: false };
    } catch (finalizeError: any) {
      if (finalizeConn) {
        try {
          await finalizeConn.rollback();
        } catch {
          // ignore rollback errors
        }
      }

      try {
        const recovered = await persistSentEmailAfterGraphSuccess({
          poolOrConn: pool,
          emailId,
          source: "graph-delegated",
          sequenceId: row.SequenceId ? Number(row.SequenceId) : null,
          stepId: row.StepId ? Number(row.StepId) : null,
          crmUserId: crmUserId ?? null,
          companyId: row.CompanyId,
        });
        if (recovered.persisted) {
          return { emailId, sent: true, skipped: false, reason: "FINALIZE_RECOVERED" };
        }
      } catch {
        // Leave SENDING. Stale recovery will fail-closed without resend.
      }

      return { emailId, sent: false, skipped: false, reason: "POST_SEND_FINALIZE_FAILED" };
    } finally {
      if (finalizeConn) finalizeConn.release();
    }
  } catch (err: any) {
    try {
      await pool.query(
        `
          UPDATE emails
          SET Status = 'FAILED'
          WHERE EmailId = ?
            AND CompanyId = ?
            AND Status IN ('QUEUED', 'SENDING')
        `,
        [emailId, claimedCompanyId]
      );

      await insertEmailEventForEmail({
        poolOrConn: pool,
        emailId,
        eventType: "FAILED",
        metadata: {
          source: "graph-delegated",
          error: safeSendFailureMessage(err),
        },
      });
    } catch {
      // ignore secondary failure logging errors
    }

    return { emailId, sent: false, skipped: false, reason: "SEND_FAILED" };
  }
}

export async function dispatchQueuedEmailByIdWithApplication(args: {
  pool: any;
  emailId: number;
}): Promise<DispatchResult> {
  const { pool, emailId } = args;
  let claimedCompanyId: number | null = null;

  try {
    const claimed = await claimDueQueuedEmailForDispatch({
      pool,
      emailId,
      requireScheduledAt: true,
    });

    if (claimed.skipped || !claimed.row) {
      return { emailId, sent: false, skipped: true, reason: claimed.reason };
    }

    const row = claimed.row;
    claimedCompanyId = row.CompanyId;

    console.log(`[Email Scheduler] Sending EmailId: ${emailId}`);

    const attachments = await getEmailAttachments({
      poolOrConn: pool,
      emailId,
      companyId: row.CompanyId,
      includeContent: true,
    });

    const stillEligible = await releaseClaimedSequenceEmailIfIneligible({
      pool,
      emailId,
      sequenceId: row.SequenceId,
      leadContactId: row.LeadContactID,
      companyId: row.CompanyId,
    });
    if (!stillEligible.eligible) {
      return {
        emailId,
        sent: false,
        skipped: true,
        reason: stillEligible.reason || "SEQUENCE_NOT_ELIGIBLE",
      };
    }

    const suppressed = await blockDispatchIfSuppressed({
      pool,
      emailId,
      toEmail: String(row.ToEmail || ""),
      sequenceId: row.SequenceId,
      leadContactId: row.LeadContactID,
    });
    if (suppressed.blocked) {
      return {
        emailId,
        sent: false,
        skipped: true,
        reason: suppressed.reason || "RECIPIENT_SUPPRESSED",
      };
    }

    await recordGraphSendAttempt({
      pool,
      emailId,
      source: "graph-application",
      sequenceId: row.SequenceId,
      stepId: row.StepId,
    });

    const sentIds = await sendMailWithApplicationGraph({
      to: String(row.ToEmail || ""),
      subject: String(row.Subject || ""),
      htmlBody: await applyOptionalEmailTracking({
        pool,
        html: buildSendableHtmlWithUnsubscribe({
          body: String(row.Body || ""),
          inlineContentIds: attachments
            .filter((att) => att.isInline && att.contentId)
            .map((att) => String(att.contentId || "")),
          emailId,
          toEmail: String(row.ToEmail || ""),
        }),
        emailId,
        toEmail: String(row.ToEmail || ""),
      }),
      attachments: mapToGraphFileAttachments(attachments),
    });

    let finalizeConn: any;
    try {
      finalizeConn = await pool.getConnection();
      await finalizeConn.beginTransaction();

      await insertEmailEventForEmail({
        poolOrConn: finalizeConn,
        emailId,
        eventType: "SENT",
        uniqueByEventType: true,
        metadata: {
          source: "graph-application",
          sequenceId: row.SequenceId ? Number(row.SequenceId) : null,
          stepId: row.StepId ? Number(row.StepId) : null,
          graphMessageId: sentIds.graphMessageId,
          conversationId: sentIds.conversationId,
          internetMessageId: sentIds.internetMessageId,
        },
      });

      await finalizeConn.query(
        `
          UPDATE emails
          SET Status = 'SENT',
              SentAt = UTC_TIMESTAMP(),
              ProviderMessageId = COALESCE(?, ProviderMessageId),
              ThreadId = COALESCE(?, ThreadId)
          WHERE EmailId = ?
            AND CompanyId = ?
        `,
        [sentIds.internetMessageId, sentIds.conversationId, emailId, row.CompanyId]
      );

      await finalizeConn.query(
        `
          UPDATE leadcontacts lc
          INNER JOIN emails e
            ON e.LeadContactID = lc.LeadContactID
           AND e.CompanyId = lc.CompanyId
          SET lc.EmailSent = 1
          WHERE e.EmailId = ?
            AND e.CompanyId = ?
        `,
        [emailId, row.CompanyId]
      );

      if (Number(row.SequenceId || 0) > 0 && Number(row.StepId || 0) > 0) {
        try {
          await advanceSequenceAfterEmailSent({
            conn: finalizeConn,
            emailId,
          });
        } catch (sequenceError) {
          console.error(
            `[Email Sequence] Failed to advance after application send for EmailId: ${emailId}`,
            sequenceError
          );
        }
      }

      await finalizeConn.commit();
      return { emailId, sent: true, skipped: false };
    } catch {
      if (finalizeConn) {
        try {
          await finalizeConn.rollback();
        } catch {
          // ignore rollback errors
        }
      }

      try {
        const recovered = await persistSentEmailAfterGraphSuccess({
          poolOrConn: pool,
          emailId,
          source: "graph-application",
          sequenceId: row.SequenceId ? Number(row.SequenceId) : null,
          stepId: row.StepId ? Number(row.StepId) : null,
          sentIds,
          companyId: row.CompanyId,
        });
        if (Number(row.SequenceId || 0) > 0 && Number(row.StepId || 0) > 0) {
          try {
            await advanceSequenceAfterEmailSent({
              conn: pool,
              emailId,
            });
          } catch (sequenceError) {
            console.error(
              `[Email Sequence] Failed to advance after application send recovery for EmailId: ${emailId}`,
              sequenceError
            );
          }
        }
        if (recovered.persisted) {
          return { emailId, sent: true, skipped: false, reason: "FINALIZE_RECOVERED" };
        }
      } catch {
        // Leave SENDING. Stale recovery will fail-closed without resend.
      }

      return { emailId, sent: false, skipped: false, reason: "POST_SEND_FINALIZE_FAILED" };
    } finally {
      if (finalizeConn) finalizeConn.release();
    }
  } catch (err: any) {
    try {
      await pool.query(
        `
          UPDATE emails
          SET Status = 'FAILED'
          WHERE EmailId = ?
            AND CompanyId = ?
            AND Status IN ('QUEUED', 'SENDING')
        `,
        [emailId, claimedCompanyId]
      );

      await insertEmailEventForEmail({
        poolOrConn: pool,
        emailId,
        eventType: "FAILED",
        metadata: {
          source: "graph-application",
          error: safeSendFailureMessage(err),
        },
      });
    } catch {
      // ignore secondary failure logging errors
    }

    return { emailId, sent: false, skipped: false, reason: "SEND_FAILED" };
  }
}

export function normalizeEmailIds(rows: any[]): number[] {
  return (Array.isArray(rows) ? rows : [])
    .map((r) => parseEmailId(r?.EmailId))
    .filter((id) => id > 0);
}

