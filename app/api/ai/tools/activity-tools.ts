// app/api/ai/tools/activity-tools.ts
// Direct DB queries for activity operations

/**
 * Add an activity (Call, Email, Meeting, Visit, Other) to a lead.
 */
export async function addActivity(pool: any, params: any) {
  const { leadId, Mode, Notes, Status, ActivityDate } = params;

  // Validate required fields
  if (!leadId || !Mode?.trim() || !Notes?.trim() || !Status?.trim()) {
    return {
      success: false,
      message:
        "Missing required fields. I need: leadId, Mode (Call/Email/Meeting/Visit/Other), Notes, and Status.",
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

  // Validate Mode
  const validModes = ["Call", "Email", "Meeting", "Visit", "Other"];
  const normalizedMode =
    validModes.find((m) => m.toLowerCase() === Mode.toLowerCase().trim()) ||
    null;

  if (!normalizedMode) {
    return {
      success: false,
      message: `Invalid activity mode "${Mode}". Must be one of: ${validModes.join(", ")}.`,
    };
  }

  // Resolve StatusId
  const [statusRows]: any = await pool.query(
    `SELECT StatusId FROM LeadStatuses WHERE StatusName = ?`,
    [Status]
  );
  const StatusId = statusRows[0]?.StatusId ?? 1;

  // Parse date — default to today
  let activityDate: Date;
  try {
    activityDate = ActivityDate ? new Date(ActivityDate) : new Date();
    if (isNaN(activityDate.getTime())) {
      activityDate = new Date();
    }
  } catch {
    activityDate = new Date();
  }

  // Insert activity
  const [insertResult]: any = await pool.query(
    `
    INSERT INTO LeadActivities
      (LeadId, ActivityType, Notes, StatusId, ActivityDate)
    VALUES (?, ?, ?, ?, ?)
    `,
    [leadId, normalizedMode, Notes, StatusId, activityDate]
  );

  return {
    success: true,
    ActivityId: insertResult.insertId,
    message: `Activity logged: ${normalizedMode} for ${companyName} (Lead #${leadId}). Status updated to "${Status}".`,
  };
}

/**
 * Update an existing activity.
 */
export async function updateActivity(pool: any, params: any) {
  const { ActivityId, Mode, Notes, Status, ActivityDate } = params;

  if (!ActivityId) {
    return {
      success: false,
      message: "ActivityId is required to update an activity.",
    };
  }

  // Check activity exists
  const [existing]: any = await pool.query(
    `SELECT ActivityId FROM LeadActivities WHERE ActivityId = ?`,
    [ActivityId]
  );

  if (!existing.length) {
    return {
      success: false,
      message: `Activity #${ActivityId} not found.`,
    };
  }

  // Resolve StatusId if Status provided
  let StatusId: number | null = null;
  if (Status) {
    const [statusRows]: any = await pool.query(
      `SELECT StatusId FROM LeadStatuses WHERE StatusName = ?`,
      [Status]
    );
    StatusId = statusRows[0]?.StatusId ?? null;
  }

  // Build dynamic update
  const updates: string[] = [];
  const values: any[] = [];

  if (Mode) {
    updates.push("ActivityType = ?");
    values.push(Mode);
  }
  if (Notes) {
    updates.push("Notes = ?");
    values.push(Notes);
  }
  if (StatusId !== null) {
    updates.push("StatusId = ?");
    values.push(StatusId);
  }
  if (ActivityDate) {
    updates.push("ActivityDate = ?");
    values.push(new Date(ActivityDate));
  }

  if (updates.length === 0) {
    return {
      success: false,
      message: "No fields to update. Provide Mode, Notes, Status, or ActivityDate.",
    };
  }

  values.push(ActivityId);
  await pool.query(
    `UPDATE LeadActivities SET ${updates.join(", ")} WHERE ActivityId = ?`,
    values
  );

  return {
    success: true,
    message: `Activity #${ActivityId} updated successfully.`,
  };
}