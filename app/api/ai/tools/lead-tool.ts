// app/api/ai/tools/lead-tools.ts
// Direct DB queries for lead operations — no HTTP round-trips

import { fuzzyMatch, fuzzyMatchDropdown } from "../utils/fuzzy-match";

// ─── SEARCH LEADS ───
// ═══════════════════════════════════════════════════
// REPLACE the searchLead function in your lead-tool.ts with this:
// ═══════════════════════════════════════════════════

export async function searchLead(pool: any, query: string) {
  // Create multiple search variations to handle spacing issues
  // "open text" should match "Opentext", "OpenText", "Open Text"
  const searchTerm = `%${query}%`;
  const noSpaces = `%${query.replace(/\s+/g, "")}%`; // "opentext"

  const [rows]: any = await pool.query(
    `
    SELECT
      l.LeadId,
      l.CompanyName,
      l.CompanyLocation,
      l.LeadSource,
      DATE_FORMAT(l.LeadDate, '%Y-%m-%d') AS LeadDate,
      ls.StatusName,
      u.UserName AS OwnerName,
      at.Name AS AccountType,
      lc.ContactName,
      lc.ContactEmail,
      lc.ContactPhone
    FROM leads l
    LEFT JOIN LeadStatuses ls ON l.StatusId = ls.StatusId
    LEFT JOIN Users u ON l.OwnerId = u.UserId
    LEFT JOIN AccountTypes at ON l.AccountTypeId = at.AccountTypeId
    LEFT JOIN LeadContacts lc ON lc.LeadId = l.LeadId
    WHERE l.CompanyName LIKE ?
       OR l.CompanyName LIKE ?
       OR REPLACE(l.CompanyName, ' ', '') LIKE ?
       OR lc.ContactName LIKE ?
       OR lc.ContactName LIKE ?
       OR u.UserName LIKE ?
    ORDER BY l.LeadDate DESC
    LIMIT 20
    `,
    [searchTerm, noSpaces, noSpaces, searchTerm, noSpaces, searchTerm]
  );

  // Group contacts per lead
  const grouped: Record<number, any> = {};
  for (const row of rows) {
    if (!grouped[row.LeadId]) {
      grouped[row.LeadId] = {
        LeadId: row.LeadId,
        CompanyName: row.CompanyName,
        CompanyLocation: row.CompanyLocation,
        LeadSource: row.LeadSource,
        LeadDate: row.LeadDate,
        StatusName: row.StatusName,
        OwnerName: row.OwnerName,
        AccountType: row.AccountType || "Lead",
        Contacts: [],
      };
    }
    if (row.ContactName || row.ContactEmail) {
      // Avoid duplicate contacts
      const existing = grouped[row.LeadId].Contacts;
      if (!existing.some((c: any) => c.ContactName === row.ContactName && c.ContactEmail === row.ContactEmail)) {
        existing.push({
          ContactName: row.ContactName,
          ContactEmail: row.ContactEmail,
          ContactPhone: row.ContactPhone,
        });
      }
    }
  }

  const leads = Object.values(grouped);

  return {
    success: true,
    count: leads.length,
    leads,
    message:
      leads.length === 0
        ? `No leads found matching "${query}".`
        : `Found ${leads.length} result(s) matching "${query}".`,
  };
}

// ─── GET LEAD DETAILS ───
export async function getLeadDetails(pool: any, leadId: number) {
  // Lead basic info
  const [leadRows]: any = await pool.query(
    `
    SELECT
      l.LeadId, l.CompanyName, l.CompanyLocation, l.LeadSource,
      DATE_FORMAT(l.LeadDate, '%Y-%m-%d') AS LeadDate,
      l.LeadNotes, ls.StatusName,
      at.Name AS AccountTypeName,
      u.UserName AS OwnerName
    FROM Leads l
    LEFT JOIN LeadStatuses ls ON l.StatusId = ls.StatusId
    LEFT JOIN Users u ON l.OwnerId = u.UserId
    LEFT JOIN AccountTypes at ON l.AccountTypeId = at.AccountTypeId
    WHERE l.LeadId = ?
    `,
    [leadId]
  );

  if (!leadRows.length) {
    return { success: false, message: `Lead #${leadId} not found.` };
  }

  // Contacts
  const [contacts]: any = await pool.query(
    `
    SELECT lc.ContactName, lc.ContactTitle, lc.ContactEmail, lc.ContactPhone,
           cr.Role AS ContactRoleName
    FROM LeadContacts lc
    LEFT JOIN ContactRoles cr ON lc.ContactRoleId = cr.RoleId
    WHERE lc.LeadId = ?
    `,
    [leadId]
  );

  // Activities (last 5)
  const [activities]: any = await pool.query(
    `
    SELECT la.ActivityId, DATE_FORMAT(la.ActivityDate, '%Y-%m-%d') AS ActivityDate,
           la.ActivityType AS Mode, la.Notes, ls.StatusName AS Status
    FROM LeadActivities la
    LEFT JOIN LeadStatuses ls ON la.StatusId = ls.StatusId
    WHERE la.LeadId = ?
    ORDER BY la.ActivityDate DESC
    LIMIT 5
    `,
    [leadId]
  );

  // Reminders (last 5)
  const [reminders]: any = await pool.query(
    `
    SELECT lr.ReminderId, DATE_FORMAT(lr.ReminderDate, '%Y-%m-%d') AS ReminderDate,
           lr.ReminderNote AS Notes, lr.Status
    FROM LeadReminders lr
    WHERE lr.LeadId = ?
    ORDER BY lr.ReminderDate DESC
    LIMIT 5
    `,
    [leadId]
  );

  // Opportunities count
  const [oppCount]: any = await pool.query(
    `SELECT COUNT(*) AS count FROM Opportunities WHERE LeadId = ? AND IsDeleted = 0`,
    [leadId]
  );

  return {
    success: true,
    ...leadRows[0],
    Contacts: contacts,
    RecentActivities: activities,
    RecentReminders: reminders,
    OpportunityCount: oppCount[0]?.count ?? 0,
  };
}

// ─── LOAD DROPDOWN OPTIONS ───
async function loadDropdowns(pool: any) {
  const [companies]: any = await pool.query(
    `SELECT DISTINCT CompanyName FROM Leads WHERE CompanyName IS NOT NULL ORDER BY CompanyName`
  );
  const [owners]: any = await pool.query(
    `SELECT DISTINCT UserId, UserName FROM Users WHERE UserName IS NOT NULL ORDER BY UserId`
  );
  const [roles]: any = await pool.query(
    `SELECT DISTINCT Role FROM ContactRoles WHERE Role IS NOT NULL ORDER BY Role`
  );
  const [sources]: any = await pool.query(
    `SELECT DISTINCT LeadSource FROM Leads WHERE LeadSource IS NOT NULL ORDER BY LeadSource`
  );

  return {
    companies: companies.map((c: any) => c.CompanyName),
    owners: owners.map((o: any) => o.UserName),
    roles: roles.map((r: any) => r.Role),
    sources: sources.map((s: any) => s.LeadSource),
  };
}

// ─── GET DROPDOWNS (exposed as a tool) ───
export async function getDropdowns(pool: any) {
  const dropdowns = await loadDropdowns(pool);

  // Also fetch opportunity-related dropdowns
  const [services]: any = await pool.query(
    `SELECT ServiceId, ServiceName FROM Services ORDER BY ServiceId`
  );
  const [engagementModels]: any = await pool.query(
    `SELECT EngagementId, Engagement_ModelName FROM Engagement_Models ORDER BY EngagementId`
  );
  const [oppStatuses]: any = await pool.query(
    `SELECT Opportunity_StatusId, Opportunities_StatusName FROM Opportunities_Status ORDER BY Opportunity_StatusId`
  );

return {
    success: true,
    message: "Dropdown options loaded.",
    ...dropdowns,
    services: services.map((s: any) => ({
      id: s.ServiceId,
      name: s.ServiceName,
    })),
    engagementModels: engagementModels.map((e: any) => ({
      id: e.EngagementId,
      name: e.Engagement_ModelName,
    })),
    opportunityStatuses: oppStatuses.map((o: any) => ({
      id: o.Opportunity_StatusId,
      name: o.Opportunities_StatusName,
    })),
  };
}

// ─── CREATE LEAD ───
export async function createLead(pool: any, params: any) {
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // Load and fuzzy-match dropdown fields
    const dropdowns = await loadDropdowns(pool);

    const companyMatch = fuzzyMatchDropdown(
      params.CompanyName,
      dropdowns.companies
    );
    const ownerMatch = fuzzyMatchDropdown(params.OwnerName, dropdowns.owners);
    const roleMatch = fuzzyMatchDropdown(
      params.ContactRoleName,
      dropdowns.roles
    );
    const sourceMatch = params.LeadSource
      ? fuzzyMatchDropdown(params.LeadSource, dropdowns.sources)
      : { matched: true, value: params.LeadSource };

    // Collect mismatches
    const mismatches: string[] = [];
    if (!companyMatch.matched)
      mismatches.push(
        `CompanyName "${params.CompanyName}" doesn't match any known company. Available: ${dropdowns.companies.slice(0, 5).join(", ")}${dropdowns.companies.length > 5 ? "..." : ""}`
      );
    if (!ownerMatch.matched)
      mismatches.push(
        `OwnerName "${params.OwnerName}" doesn't match any user. Available: ${dropdowns.owners.join(", ")}`
      );
    if (!roleMatch.matched)
      mismatches.push(
        `ContactRoleName "${params.ContactRoleName}" doesn't match. Available: ${dropdowns.roles.join(", ")}`
      );

    if (mismatches.length > 0) {
      await conn.rollback();
      return {
        success: false,
        message:
          "Some values don't match dropdown options:\n• " +
          mismatches.join("\n• "),
      };
    }

    // Resolve StatusId (default: "New")
    const [statusRows]: any = await conn.query(
      `SELECT StatusId FROM LeadStatuses WHERE StatusName = ?`,
      [params.StatusName || "New"]
    );
    const StatusId = statusRows[0]?.StatusId ?? 1;

    // Resolve OwnerId
    const [ownerRows]: any = await conn.query(
      `SELECT UserId FROM Users WHERE UserName = ?`,
      [ownerMatch.value]
    );
    const OwnerId = ownerRows[0]?.UserId ?? null;

    // Insert Lead
    const [leadInsert]: any = await conn.query(
      `
      INSERT INTO Leads
        (CompanyName, CompanyLocation, LeadSource, LeadDate, LeadNotes, StatusId, OwnerId)
      VALUES (?, ?, ?, CURDATE(), ?, ?, ?)
      `,
      [
        companyMatch.value,
        params.CompanyLocation || null,
        sourceMatch.value || null,
        params.Notes || null,
        StatusId,
        OwnerId,
      ]
    );

    const LeadId = leadInsert.insertId;

    // Insert Contact
    const [roleRows]: any = await conn.query(
      `SELECT RoleId FROM ContactRoles WHERE Role = ?`,
      [roleMatch.value]
    );
    const ContactRoleId = roleRows[0]?.RoleId;

    if (!ContactRoleId) {
      await conn.rollback();
      return {
        success: false,
        message: `Could not resolve role "${roleMatch.value}".`,
      };
    }

    await conn.query(
      `
      INSERT INTO LeadContacts
        (LeadId, ContactName, ContactEmail, ContactPhone, ContactTitle, ContactRoleId)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        LeadId,
        params.ContactName,
        params.ContactEmail,
        params.ContactPhone || null,
        params.ContactTitle || null,
        ContactRoleId,
      ]
    );

    await conn.commit();

    return {
      success: true,
      LeadId,
      message: `Lead created successfully! Lead #${LeadId} for ${companyMatch.value}, contact: ${params.ContactName}.`,
    };
  } catch (err: any) {
    await conn.rollback();
    return { success: false, message: `Failed to create lead: ${err.message}` };
  } finally {
    conn.release();
  }
}

// ─── UPDATE LEAD ───
export async function updateLead(pool: any, params: any) {
  const { leadId, ...fields } = params;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // Check lead exists
    const [existing]: any = await conn.query(
      `SELECT LeadId FROM Leads WHERE LeadId = ?`,
      [leadId]
    );
    if (!existing.length) {
      await conn.rollback();
      return { success: false, message: `Lead #${leadId} not found.` };
    }

    // Fuzzy match dropdown fields if provided
    const dropdowns = await loadDropdowns(pool);

    if (fields.CompanyName) {
      const m = fuzzyMatchDropdown(fields.CompanyName, dropdowns.companies);
      if (!m.matched) {
        await conn.rollback();
        return {
          success: false,
          message: `CompanyName "${fields.CompanyName}" doesn't match. Available: ${dropdowns.companies.slice(0, 5).join(", ")}`,
        };
      }
      fields.CompanyName = m.value;
    }

    if (fields.OwnerName) {
      const m = fuzzyMatchDropdown(fields.OwnerName, dropdowns.owners);
      if (!m.matched) {
        await conn.rollback();
        return {
          success: false,
          message: `OwnerName "${fields.OwnerName}" doesn't match. Available: ${dropdowns.owners.join(", ")}`,
        };
      }
      fields.OwnerName = m.value;
    }

    // Resolve IDs
    let statusId = null;
    if (fields.StatusName) {
      const [rows]: any = await conn.query(
        `SELECT StatusId FROM LeadStatuses WHERE StatusName = ?`,
        [fields.StatusName]
      );
      if (rows.length) statusId = rows[0].StatusId;
    }

    let ownerId = null;
    if (fields.OwnerName) {
      const [rows]: any = await conn.query(
        `SELECT UserId FROM Users WHERE UserName = ?`,
        [fields.OwnerName]
      );
      if (rows.length) ownerId = rows[0].UserId;
    }

    // Build dynamic UPDATE query for lead fields
    const updateFields: string[] = [];
    const updateValues: any[] = [];

    if (fields.CompanyName) {
      updateFields.push("CompanyName = ?");
      updateValues.push(fields.CompanyName);
    }
    if (fields.CompanyLocation) {
      updateFields.push("CompanyLocation = ?");
      updateValues.push(fields.CompanyLocation);
    }
    if (fields.LeadSource) {
      updateFields.push("LeadSource = ?");
      updateValues.push(fields.LeadSource);
    }
    if (fields.LeadNotes !== undefined) {
      updateFields.push("LeadNotes = ?");
      updateValues.push(fields.LeadNotes);
    }
    if (statusId !== null) {
      updateFields.push("StatusId = ?");
      updateValues.push(statusId);
    }
    if (ownerId !== null) {
      updateFields.push("OwnerId = ?");
      updateValues.push(ownerId);
    }

    if (updateFields.length > 0) {
      updateValues.push(leadId);
      await conn.query(
        `UPDATE Leads SET ${updateFields.join(", ")} WHERE LeadId = ?`,
        updateValues
      );
    }

    // Update contact if contact fields provided
    const contactFields = [
      "ContactName",
      "ContactEmail",
      "ContactPhone",
      "ContactTitle",
      "ContactRoleName",
    ];
    const hasContactUpdate = contactFields.some((f) => fields[f]);

    if (hasContactUpdate) {
      // Get existing contacts
      const [existingContacts]: any = await conn.query(
        `SELECT * FROM LeadContacts WHERE LeadId = ? LIMIT 1`,
        [leadId]
      );

      if (existingContacts.length > 0) {
        const contactUpdates: string[] = [];
        const contactValues: any[] = [];

        if (fields.ContactName) {
          contactUpdates.push("ContactName = ?");
          contactValues.push(fields.ContactName);
        }
        if (fields.ContactEmail) {
          contactUpdates.push("ContactEmail = ?");
          contactValues.push(fields.ContactEmail);
        }
        if (fields.ContactPhone) {
          contactUpdates.push("ContactPhone = ?");
          contactValues.push(fields.ContactPhone);
        }
        if (fields.ContactTitle) {
          contactUpdates.push("ContactTitle = ?");
          contactValues.push(fields.ContactTitle);
        }
        if (fields.ContactRoleName) {
          const roleM = fuzzyMatchDropdown(
            fields.ContactRoleName,
            dropdowns.roles
          );
          if (roleM.matched) {
            const [roleRows]: any = await conn.query(
              `SELECT RoleId FROM ContactRoles WHERE Role = ?`,
              [roleM.value]
            );
            if (roleRows.length) {
              contactUpdates.push("ContactRoleId = ?");
              contactValues.push(roleRows[0].RoleId);
            }
          }
        }

        if (contactUpdates.length > 0) {
          contactValues.push(leadId);
          await conn.query(
            `UPDATE LeadContacts SET ${contactUpdates.join(", ")} WHERE LeadId = ? LIMIT 1`,
            contactValues
          );
        }
      }
    }

    await conn.commit();

    const updatedFieldNames = Object.keys(fields).filter(
      (k) => fields[k] !== undefined
    );
    return {
      success: true,
      LeadId: leadId,
      message: `Lead #${leadId} updated: ${updatedFieldNames.join(", ")}.`,
    };
  } catch (err: any) {
    await conn.rollback();
    return { success: false, message: `Failed to update lead: ${err.message}` };
  } finally {
    conn.release();
  }
}

// ─── DELETE LEAD ───
export async function deleteLead(
  pool: any,
  leadId: number,
  confirmed: boolean
) {
  if (!confirmed) {
    // Fetch lead info for confirmation message
    const [rows]: any = await pool.query(
      `SELECT l.CompanyName, u.UserName AS OwnerName
       FROM Leads l LEFT JOIN Users u ON l.OwnerId = u.UserId
       WHERE l.LeadId = ?`,
      [leadId]
    );
    if (!rows.length) {
      return { success: false, message: `Lead #${leadId} not found.` };
    }
    return {
      success: false,
      needsConfirmation: true,
      message: `Are you sure you want to delete "${rows[0].CompanyName}" (Lead #${leadId}, Owner: ${rows[0].OwnerName})? This will permanently remove all contacts, activities, reminders, and opportunities. Say "yes, delete it" to confirm.`,
    };
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Check exists
    const [existing]: any = await conn.query(
      `SELECT CompanyName FROM Leads WHERE LeadId = ?`,
      [leadId]
    );
    if (!existing.length) {
      await conn.rollback();
      return { success: false, message: `Lead #${leadId} not found.` };
    }

    const companyName = existing[0].CompanyName;

    // Delete child records then lead
    await conn.query(`DELETE FROM LeadContacts WHERE LeadId = ?`, [leadId]);
    await conn.query(`DELETE FROM LeadActivities WHERE LeadId = ?`, [leadId]);
    await conn.query(`DELETE FROM LeadReminders WHERE LeadId = ?`, [leadId]);
    await conn.query(`DELETE FROM Opportunities WHERE LeadId = ?`, [leadId]);
    await conn.query(`DELETE FROM Leads WHERE LeadId = ?`, [leadId]);

    await conn.commit();

    return {
      success: true,
      message: `Lead "${companyName}" (#${leadId}) and all related data deleted successfully.`,
    };
  } catch (err: any) {
    await conn.rollback();
    return { success: false, message: `Failed to delete lead: ${err.message}` };
  } finally {
    conn.release();
  }
}