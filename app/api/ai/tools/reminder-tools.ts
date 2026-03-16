// app/api/ai/tools/reminder-tools.ts
// Direct DB queries for reminder operations

/**
 * Create a reminder for a lead.
 */
export async function addReminder(pool: any, params: any) {
  const { leadId, ReminderDate, Notes, Status, Notification } = params;

  // Validate required fields
  if (!leadId || !ReminderDate || !Notes?.trim()) {
    return {
      success: false,
      message:
        "Missing required fields. I need: leadId, ReminderDate (YYYY-MM-DD), and Notes.",
    };
  }

  // Validate lead exists
  const [leadRows]: any = await pool.query(
    `SELECT l.LeadId, l.CompanyName FROM Leads l WHERE l.LeadId = ?`,
    [leadId]
  );

  if (!leadRows.length) {
    return {
      success: false,
      message: `Lead #${leadId} not found. Use search_lead to find the correct lead first.`,
    };
  }

  const companyName = leadRows[0].CompanyName;

  // Parse and validate date
  let reminderDate: Date;
  try {
    reminderDate = new Date(ReminderDate);
    if (isNaN(reminderDate.getTime())) {
      return {
        success: false,
        message: `Invalid date "${ReminderDate}". Please use YYYY-MM-DD format.`,
      };
    }
  } catch {
    return {
      success: false,
      message: `Could not parse date "${ReminderDate}". Please use YYYY-MM-DD format.`,
    };
  }

  // Insert reminder
  const [insertResult]: any = await pool.execute(
    `
    INSERT INTO LeadReminders
      (LeadId, ReminderDate, ReminderNote, Status, NotificationChannels, CreatedAt)
    VALUES (?, ?, ?, ?, ?, NOW())
    `,
    [
      leadId,
      reminderDate,
      Notes,
      Status || "Pending",
      Notification || "Email",
    ]
  );

  // Format the date for display
  const displayDate = reminderDate.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return {
    success: true,
    ReminderId: insertResult.insertId,
    message: `Reminder set for ${companyName} (Lead #${leadId}) on ${displayDate}: "${Notes}".`,
  };
}

/**
 * Update an existing reminder.
 */
export async function updateReminder(pool: any, params: any) {
  const { ReminderId, ReminderDate, Notes, Status, Notification } = params;

  if (!ReminderId) {
    return {
      success: false,
      message: "ReminderId is required to update a reminder.",
    };
  }

  // Check reminder exists
  const [existing]: any = await pool.query(
    `SELECT ReminderId FROM LeadReminders WHERE ReminderId = ?`,
    [ReminderId]
  );

  if (!existing.length) {
    return {
      success: false,
      message: `Reminder #${ReminderId} not found.`,
    };
  }

  // Build dynamic update
  const updates: string[] = [];
  const values: any[] = [];

  if (ReminderDate) {
    const parsedDate = new Date(ReminderDate);
    if (isNaN(parsedDate.getTime())) {
      return {
        success: false,
        message: `Invalid date "${ReminderDate}". Use YYYY-MM-DD format.`,
      };
    }
    updates.push("ReminderDate = ?");
    values.push(parsedDate);
  }
  if (Notes) {
    updates.push("ReminderNote = ?");
    values.push(Notes);
  }
  if (Status) {
    updates.push("Status = ?");
    values.push(Status);
  }
  if (Notification) {
    updates.push("NotificationChannels = ?");
    values.push(Notification);
  }

  if (updates.length === 0) {
    return {
      success: false,
      message: "No fields to update. Provide ReminderDate, Notes, Status, or Notification.",
    };
  }

  values.push(ReminderId);
  await pool.execute(
    `UPDATE LeadReminders SET ${updates.join(", ")} WHERE ReminderId = ?`,
    values
  );

  return {
    success: true,
    message: `Reminder #${ReminderId} updated successfully.`,
  };
}