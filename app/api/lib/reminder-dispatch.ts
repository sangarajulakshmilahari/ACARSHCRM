import { getPool } from "@/config/db";
import { sendReminderNotificationEmail } from "@/app/api/lib/mailer";

export type ReminderDispatchSummary = {
  checked: number;
  sent: number;
  skipped: number;
  failed: number;
};

type DueReminderRow = {
  ReminderId: number;
  ReminderDate: string | Date;
  ReminderNote: string;
  UserEmail: string;
};

async function fetchDueReminders(): Promise<DueReminderRow[]> {
  const pool = await getPool();

  // Keep a small grace window to tolerate scheduler jitter.
  // Intended behavior: send roughly 1 hour before reminder time.
  const fromMinute = Number(process.env.REMINDER_DISPATCH_FROM_MINUTE ?? 55);
  const toMinute = Number(process.env.REMINDER_DISPATCH_TO_MINUTE ?? 60);
  const limit = Number(process.env.REMINDER_DISPATCH_LIMIT ?? 200);

  const [rows]: any = await pool.query(
    `
      SELECT
        lr.ReminderId,
        lr.ReminderDate,
        lr.ReminderNote,
        u.Email AS UserEmail
      FROM LeadReminders lr
      INNER JOIN Users u ON u.UserId = lr.CreatedBy
      WHERE
        COALESCE(lr.EmailSent, 0) = 0
        AND COALESCE(lr.EmailProcessing, 0) = 0
        AND COALESCE(lr.IsCompleted, 0) = 0
        AND LOWER(COALESCE(lr.Status, 'pending')) NOT IN ('completed', 'cancelled', 'done')
        AND TIMESTAMPDIFF(MINUTE, NOW(), lr.ReminderDate) BETWEEN ? AND ?
      ORDER BY lr.ReminderDate ASC
      LIMIT ?
    `,
    [fromMinute, toMinute, limit]
  );

  return rows as DueReminderRow[];
}

async function claimReminder(reminderId: number) {
  const pool = await getPool();

  const [result]: any = await pool.execute(
    `
      UPDATE LeadReminders
      SET EmailProcessing = 1,
          EmailProcessingAt = NOW(),
          EmailLastAttemptAt = NOW(),
          EmailLastError = NULL
      WHERE ReminderId = ?
        AND COALESCE(EmailSent, 0) = 0
        AND COALESCE(EmailProcessing, 0) = 0
    `,
    [reminderId]
  );

  return Number(result?.affectedRows || 0) > 0;
}

async function markReminderSent(reminderId: number) {
  const pool = await getPool();
  await pool.execute(
    `
      UPDATE LeadReminders
      SET EmailSent = 1,
          EmailSentAt = NOW(),
          EmailProcessing = 0,
          EmailLastError = NULL
      WHERE ReminderId = ?
    `,
    [reminderId]
  );
}

async function markReminderFailed(reminderId: number, reason: string) {
  const pool = await getPool();
  await pool.execute(
    `
      UPDATE LeadReminders
      SET EmailProcessing = 0,
          EmailLastError = ?,
          EmailLastAttemptAt = NOW()
      WHERE ReminderId = ?
    `,
    [reason.slice(0, 2000), reminderId]
  );
}

export async function dispatchReminderEmails(): Promise<ReminderDispatchSummary> {
  const summary: ReminderDispatchSummary = {
    checked: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  };

  const dueReminders = await fetchDueReminders();
  summary.checked = dueReminders.length;

  for (const reminder of dueReminders) {
    const reminderId = Number(reminder.ReminderId);

    if (!reminder.UserEmail) {
      summary.skipped += 1;
      await markReminderFailed(reminderId, "Recipient email not found for reminder creator");
      continue;
    }

    const claimed = await claimReminder(reminderId);
    if (!claimed) {
      summary.skipped += 1;
      continue;
    }

    try {
      await sendReminderNotificationEmail({
        to: reminder.UserEmail,
        reminderNotes: reminder.ReminderNote || "",
        reminderDateTime: new Date(reminder.ReminderDate),
      });

      await markReminderSent(reminderId);
      summary.sent += 1;
    } catch (error: any) {
      summary.failed += 1;
      await markReminderFailed(
        reminderId,
        String(error?.message || "Unknown reminder email dispatch error")
      );
    }
  }

  return summary;
}

