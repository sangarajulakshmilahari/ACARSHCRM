import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import {
  authorizeEmailDispatchRequest,
  dispatchQueuedEmailByIdWithApplication,
  EMAIL_DISPATCH_TOKEN_HEADER,
  normalizeEmailIds,
  recoverStaleSendingEmails,
} from "@/app/api/lib/email-dispatch";

export async function POST(req: NextRequest) {
  try {
    const auth = authorizeEmailDispatchRequest(req.headers.get(EMAIL_DISPATCH_TOKEN_HEADER));
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error || "Forbidden" }, { status: auth.status || 403 });
    }

    const batchSize = Math.min(
      200,
      Math.max(1, Number(process.env.EMAIL_SCHEDULER_BATCH_SIZE || 25))
    );

    const pool = await getPool();
    const recovery = await recoverStaleSendingEmails({
      pool,
      limit: batchSize,
    });
    if (recovery.recoveredQueued || recovery.markedUncertain) {
      console.log(
        `[Email Scheduler] Recovered stale SENDING emails queued=${recovery.recoveredQueued} uncertain=${recovery.markedUncertain}`
      );
    }
    const [rows]: any = await pool.query(
      `
        SELECT e.EmailId
        FROM emails e
        INNER JOIN leadcontacts lc
          ON lc.LeadContactID = e.LeadContactID
         AND lc.CompanyId = e.CompanyId
        INNER JOIN leads l
          ON l.LeadId = lc.LeadId
         AND l.CompanyId = e.CompanyId
        WHERE e.Status = 'QUEUED'
          AND e.CompanyId IS NOT NULL
          AND e.ScheduledAt IS NOT NULL
          AND e.ScheduledAt <= UTC_TIMESTAMP()
        ORDER BY e.ScheduledAt ASC, e.EmailId ASC
        LIMIT ?
      `,
      [batchSize]
    );

    const emailIds = normalizeEmailIds(rows);
    console.log("[Email Scheduler] Found " + emailIds.length + " queued emails");
    let sentCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    const results: Array<{
      emailId: number;
      sent: boolean;
      skipped: boolean;
      reason?: string;
    }> = [];

    for (const emailId of emailIds) {
      console.log(`[Email Scheduler] Processing EmailId: ${emailId}`);
      const result = await dispatchQueuedEmailByIdWithApplication({
        pool,
        emailId,
      });

      results.push(result);

      if (result.skipped) skippedCount += 1;
      else if (result.sent) sentCount += 1;
      else failedCount += 1;

      if (result.sent) {
        console.log(`[Email Scheduler] EmailId: ${emailId} marked SENT`);
      } else if (result.skipped) {
        console.log(
          `[Email Scheduler] EmailId: ${emailId} skipped (${result.reason || "SKIPPED"})`
        );
      } else {
        console.error(
          `[Email Scheduler] Failed EmailId: ${emailId} (${result.reason || "SEND_FAILED"})`
        );
      }
    }

    return NextResponse.json({
      success: true,
      processed: emailIds.length,
      sentCount,
      failedCount,
      skippedCount,
      recoveredQueued: recovery.recoveredQueued,
      markedUncertain: recovery.markedUncertain,
      results,
    });
  } catch (error) {
    console.error("[email-dispatch] POST error", error);
    return NextResponse.json({ error: "Failed to dispatch scheduled emails" }, { status: 500 });
  }
}

