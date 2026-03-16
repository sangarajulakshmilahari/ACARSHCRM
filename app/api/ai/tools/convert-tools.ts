// app/api/ai/tools/convert-tools.ts
// Direct DB queries for lead conversion operations

/**
 * Convert a lead to the next stage: Lead → Prospect → Account
 * Mirrors the logic in /api/employees/leads/[leadID]/convert/route.ts
 */
export async function convertLead(
  pool: any,
  leadId: number,
  confirmed: boolean
) {
  // First, get current state for confirmation message
  const [currentRows]: any = await pool.query(
    `
    SELECT l.LeadId, l.CompanyName, at.Name AS CurrentType,
           u.UserName AS OwnerName
    FROM Leads l
    LEFT JOIN AccountTypes at ON l.AccountTypeId = at.AccountTypeId
    LEFT JOIN Users u ON l.OwnerId = u.UserId
    WHERE l.LeadId = ?
    `,
    [leadId]
  );

  if (!currentRows.length) {
    return { success: false, message: `Lead #${leadId} not found.` };
  }

  const lead = currentRows[0];
  const currentType = lead.CurrentType ?? "Lead";

  // Determine next stage
  const NEXT_STAGE: Record<string, string> = {
    Lead: "Prospect",
    Prospect: "Account",
  };

  const targetType = NEXT_STAGE[currentType];

  if (!targetType) {
    return {
      success: false,
      message: `"${lead.CompanyName}" is already an ${currentType}. No further conversion possible.`,
    };
  }

  // If not confirmed, ask for confirmation
  if (!confirmed) {
    return {
      success: false,
      needsConfirmation: true,
      message: `Convert "${lead.CompanyName}" (Lead #${leadId}) from ${currentType} → ${targetType}?\nOwner: ${lead.OwnerName || "None"}\n\nSay "yes" to confirm.`,
    };
  }

  // Execute conversion
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Get target AccountTypeId
    const [typeRows]: any = await conn.query(
      `SELECT AccountTypeId FROM AccountTypes WHERE Name = ?`,
      [targetType]
    );

    if (!typeRows.length) {
      await conn.rollback();
      return {
        success: false,
        message: `Target type "${targetType}" not found in AccountTypes table.`,
      };
    }

    const accountTypeId = typeRows[0].AccountTypeId;

    // Update the lead
    await conn.query(
      `UPDATE Leads SET AccountTypeId = ? WHERE LeadId = ?`,
      [accountTypeId, leadId]
    );

    await conn.commit();

    return {
      success: true,
      message: `"${lead.CompanyName}" converted from ${currentType} → ${targetType} successfully.`,
      from: currentType,
      to: targetType,
    };
  } catch (err: any) {
    await conn.rollback();
    return {
      success: false,
      message: `Conversion failed: ${err.message}`,
    };
  } finally {
    conn.release();
  }
}

/**
 * Convert a lead directly to Account (skipping Prospect stage).
 * Only works for leads with AccountType = "Lead" (AccountTypeId = 10).
 * Mirrors /api/employees/leads/[leadID]/converttoaccount/route.ts
 */
export async function convertLeadToAccount(
  pool: any,
  leadId: number,
  confirmed: boolean
) {
  // Get current state
  const [currentRows]: any = await pool.query(
    `
    SELECT l.LeadId, l.CompanyName, l.AccountTypeId, at.Name AS CurrentType,
           u.UserName AS OwnerName
    FROM Leads l
    LEFT JOIN AccountTypes at ON l.AccountTypeId = at.AccountTypeId
    LEFT JOIN Users u ON l.OwnerId = u.UserId
    WHERE l.LeadId = ?
    `,
    [leadId]
  );

  if (!currentRows.length) {
    return { success: false, message: `Lead #${leadId} not found.` };
  }

  const lead = currentRows[0];

  // Only leads (AccountTypeId = 10) can be directly converted to Account
  if (lead.AccountTypeId !== 10) {
    return {
      success: false,
      message: `"${lead.CompanyName}" is a ${lead.CurrentType || "non-Lead"}, not a Lead. Only Leads can be directly converted to Account. Use convert_lead for ${lead.CurrentType} → Account progression.`,
    };
  }

  // If not confirmed, ask
  if (!confirmed) {
    return {
      success: false,
      needsConfirmation: true,
      message: `Convert "${lead.CompanyName}" (Lead #${leadId}) directly to Account? This skips the Prospect stage.\nOwner: ${lead.OwnerName || "None"}\n\nSay "yes" to confirm.`,
    };
  }

  // Execute conversion
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Get Account type ID
    const [typeRows]: any = await conn.query(
      `SELECT AccountTypeId FROM AccountTypes WHERE Name = 'Account'`
    );

    if (!typeRows.length) {
      await conn.rollback();
      return {
        success: false,
        message: "Account type not found in database.",
      };
    }

    const accountTypeId = typeRows[0].AccountTypeId;

    await conn.query(
      `UPDATE Leads SET AccountTypeId = ? WHERE LeadId = ?`,
      [accountTypeId, leadId]
    );

    await conn.commit();

    return {
      success: true,
      message: `"${lead.CompanyName}" converted directly from Lead → Account successfully.`,
      from: "Lead",
      to: "Account",
    };
  } catch (err: any) {
    await conn.rollback();
    return {
      success: false,
      message: `Conversion failed: ${err.message}`,
    };
  } finally {
    conn.release();
  }
}