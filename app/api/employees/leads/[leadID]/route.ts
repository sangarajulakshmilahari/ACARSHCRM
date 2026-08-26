import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";


//  GET LEAD DETAILS

export async function GET(
  req: NextRequest,
  { params }: { params: { leadID: string } }
) {
  try {
    const leadId = Number(params.leadID);
    if (isNaN(leadId)) {
      return NextResponse.json({ error: "Invalid LeadId" }, { status: 400 });
    }

    const pool = await getPool();
    const conn = await pool.getConnection();

    try {
      /* 1. Lead Basic Details */
      const [leadRows]: any = await conn.query(
        `
        SELECT
  l.LeadId,
  l.CompanyName,
  l.CompanyLocation,
  l.LeadSource,
  DATE_FORMAT(l.LeadDate, '%Y-%m-%d') AS LeadDate,
  l.LeadNotes,
  latestStatus.StatusName,
  l.AccountTypeId,
  at.Name AS AccountTypeName,     -- ✅ ADD THIS
  u.UserName AS OwnerName
FROM Leads l
LEFT JOIN Users u ON l.OwnerId = u.UserId
LEFT JOIN AccountTypes at        -- ✅ ADD THIS
  ON l.AccountTypeId = at.AccountTypeId
LEFT JOIN (
  SELECT la1.LeadId, ls1.StatusName
  FROM LeadActivities la1
  LEFT JOIN LeadStatuses ls1 ON la1.StatusId = ls1.StatusId
  INNER JOIN (
    SELECT LeadId, MAX(ActivityDate) AS MaxActivityDate
    FROM LeadActivities
    GROUP BY LeadId
  ) la2 ON la1.LeadId = la2.LeadId AND la1.ActivityDate = la2.MaxActivityDate
) latestStatus ON latestStatus.LeadId = l.LeadId
WHERE l.LeadId = ?

        `,
        [leadId]
      );

      if (!leadRows.length) {
        return NextResponse.json({ error: "Lead not found" }, { status: 404 });
      }

      /* 2. Contacts */
      const [contacts]: any = await conn.query(
        `
        SELECT
          lc.LeadContactID,
          lc.ContactName,
          lc.ContactTitle,
          lc.ContactEmail,
          lc.LinkedInProfile,
          lc.LinkedInRequestSent,
          lc.LinkedInRequestAccepted,
          lc.EmailSent,
          cr.Role AS ContactRoleName
        FROM LeadContacts lc
        LEFT JOIN ContactRoles cr ON lc.ContactRoleId = cr.RoleId
        WHERE lc.LeadId = ?
        `,
        [leadId]
      );

      /* 3. Activities */
       const [activities]: any = await conn.query(
        `
        SELECT
          la.ActivityId,
          DATE_FORMAT(la.ActivityDate, '%Y-%m-%d') AS ActivityDate,
          la.ActivityType AS Mode,
          la.Notes,
          ls.StatusName AS Status,
          lc.ContactName
        FROM LeadActivities la
        LEFT JOIN LeadStatuses ls ON la.StatusId = ls.StatusId
        LEFT JOIN LeadContacts lc ON la.ContactId = lc.LeadContactID
        WHERE la.LeadId = ?
        ORDER BY la.ActivityDate DESC
        `,
        [leadId]
      );


      /* 4. Reminders */
      const [reminders]: any = await conn.query(
        `
        SELECT
          lr.ReminderId,
          DATE_FORMAT(lr.ReminderDate, '%Y-%m-%d') AS ReminderDate,
          lr.ReminderNote AS Notes,
          lr.Status,
          lr.NotificationChannels AS Notification
        FROM LeadReminders lr
        WHERE lr.LeadId = ?
        ORDER BY lr.ReminderDate DESC
        `,
        [leadId]
      );

      /* 5. Opportunities */
      const [opportunities]: any = await conn.query(
        `
        SELECT
          o.OpportunityId,
          DATE_FORMAT(o.CreatedOn, '%Y-%m-%d') AS CreatedDate,
          s.ServiceName AS Service,
          pm.ProbabilityRange AS Probability,
          os.Opportunities_StatusName AS Status,
          em.Engagement_ModelName AS EngagementModel,
          tech.Technology,
          cnt.OpportunityContact
        FROM Opportunities o
        LEFT JOIN Services s ON o.ServiceId = s.ServiceId
        LEFT JOIN Opportunities_Status os ON o.Opportunity_StatusId = os.Opportunity_StatusId
        LEFT JOIN Probability pm ON o.ProbabilityId = pm.ProbabilityId
        LEFT JOIN Engagement_Models em ON o.EngagementId = em.EngagementId
        LEFT JOIN (
          SELECT
            oc.OpportunityId,
            GROUP_CONCAT(sc.SubCategoryName SEPARATOR ', ') AS Technology
          FROM Opportunity_Categories oc
          JOIN SubCategory sc ON oc.SubCategoryId = sc.SubCategoryId
          GROUP BY oc.OpportunityId
        ) tech ON tech.OpportunityId = o.OpportunityId
        LEFT JOIN (
          SELECT
            OpportunityId,
            GROUP_CONCAT(
              CONCAT(
                'Full Name: ', FullName, '\n',
                'Mobile: ', MobilePhone, '\n',
                'Email: ', WorkEmail
              )
              SEPARATOR '\n'
            ) AS OpportunityContact
          FROM OpportunityContacts
          WHERE IsDeleted = 0
          GROUP BY OpportunityId
        ) cnt ON cnt.OpportunityId = o.OpportunityId
        WHERE o.LeadId = ?
          AND o.IsDeleted = 0
        ORDER BY o.CreatedOn DESC
        `,
        [leadId]
      );

      return NextResponse.json({
        ...leadRows[0],
        Contacts: contacts,
        Activities: activities,
        Reminders: reminders,
        Opportunities: opportunities,
      });
    } finally {
      conn.release();
    }
  } catch (error) {
    console.error("Get lead error:", error);
    return NextResponse.json(
      { error: "Failed to fetch lead details" },
      { status: 500 }
    );
  }
}


//  UPDATE LEAD

export async function PUT(
  req: NextRequest,
  { params }: { params: { leadID: string } }
) {
  const leadId = Number(params.leadID);
  if (isNaN(leadId)) {
    return NextResponse.json({ error: "Invalid LeadId" }, { status: 400 });
  }

  const body = await req.json();
  const {
    CompanyName,
    CompanyLocation,
    LeadSource,
    LeadDate,
    OwnerName,
    LeadNotes,
    Contacts,
  } = body;

  const pool = await getPool();
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    /* OwnerId */
    let ownerId = null;
    if (OwnerName) {
      const [rows]: any = await conn.query(
        `SELECT UserId FROM Users WHERE UserName = ?`,
        [OwnerName]
      );
      if (rows.length) ownerId = rows[0].UserId;
    }

    /* Update Lead */
    await conn.query(
      `
      UPDATE Leads SET
        CompanyName = ?,
        CompanyLocation = ?,
        LeadSource = ?,
        LeadDate = ?,
        LeadNotes = ?,
        OwnerId = ?
      WHERE LeadId = ?
      `,
      [
        CompanyName || null,
        CompanyLocation || null,
        LeadSource || null,
        LeadDate || null,
        LeadNotes || null,
        ownerId,
        leadId,
      ]
    );

    /* Contacts: update existing, insert new, delete removed (without breaking FK) */
    if (Array.isArray(Contacts)) {
      const [existingRows]: any = await conn.query(
        `SELECT LeadContactID FROM LeadContacts WHERE LeadId = ?`,
        [leadId]
      );

      const existingIds = new Set<number>(
        existingRows
          .map((r: any) => Number(r.LeadContactID))
          .filter((id: number) => !Number.isNaN(id))
      );
      const incomingExistingIds = new Set<number>();

      for (const c of Contacts) {
        let roleId = null;

        if (c.ContactRoleName) {
          const [rows]: any = await conn.query(
            `SELECT RoleId FROM ContactRoles WHERE Role = ?`,
            [c.ContactRoleName]
          );
          if (rows.length) roleId = rows[0].RoleId;
        }

        if (!roleId) {
          const [rows]: any = await conn.query(
            `SELECT RoleId FROM ContactRoles WHERE Role = 'Decision Maker' LIMIT 1`
          );
          if (rows.length) roleId = rows[0].RoleId;
        }

        const maybeContactId = Number(c?.LeadContactID ?? c?.ContactId ?? NaN);
        const isExistingContact =
          !Number.isNaN(maybeContactId) && existingIds.has(maybeContactId);

        if (isExistingContact) {
          incomingExistingIds.add(maybeContactId);

          await conn.query(
            `
            UPDATE LeadContacts
            SET
              ContactName = ?,
              ContactEmail = ?,
              ContactTitle = ?,
              ContactPhone = ?,
              ContactRoleId = ?,
              LinkedInProfile = ?,
              LinkedInRequestSent = ?,
              LinkedInRequestAccepted = ?,
              EmailSent = ?
            WHERE LeadId = ? AND LeadContactID = ?
            `,
            [
              c.ContactName || null,
              c.ContactEmail || null,
              c.ContactTitle || null,
              c.ContactPhone || null,
              roleId,
              c.LinkedInProfile || null,
              c.LinkedInRequestSent ? 1 : 0,
              c.LinkedInRequestAccepted ? 1 : 0,
              c.EmailSent ? 1 : 0,
              leadId,
              maybeContactId,
            ]
          );

          continue;
        }

        await conn.query(
          `
          INSERT INTO LeadContacts
            (LeadId, ContactName, ContactEmail, ContactTitle, ContactPhone, ContactRoleId,
             LinkedInProfile, LinkedInRequestSent, LinkedInRequestAccepted, EmailSent)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            leadId,
            c.ContactName || null,
            c.ContactEmail || null,
            c.ContactTitle || null,
            c.ContactPhone || null,
            roleId,
            c.LinkedInProfile || null,
            c.LinkedInRequestSent ? 1 : 0,
            c.LinkedInRequestAccepted ? 1 : 0,
            c.EmailSent ? 1 : 0,
          ]
        );
      }

      const deletedContactIds = [...existingIds].filter(
        (id) => !incomingExistingIds.has(id)
      );

      if (deletedContactIds.length) {
        const placeholders = deletedContactIds.map(() => "?").join(", ");

        await conn.query(
          `
          UPDATE LeadActivities
          SET ContactId = NULL
          WHERE LeadId = ? AND ContactId IN (${placeholders})
          `,
          [leadId, ...deletedContactIds]
        );

        await conn.query(
          `DELETE FROM LeadContacts WHERE LeadId = ? AND LeadContactID IN (${placeholders})`,
          [leadId, ...deletedContactIds]
        );
      }
    }

    await conn.commit();

    return NextResponse.json({
      success: true,
      LeadId: leadId,
      message: "Lead updated successfully",
    });
  } catch (error: any) {
    await conn.rollback();
    console.error("Update lead error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update lead" },
      { status: 500 }
    );
  } finally {
    conn.release();
  }
}


//  DELETE LEAD

export async function DELETE(
  req: NextRequest,
  { params }: { params: { leadID: string } }
) {
  const leadId = Number(params.leadID);
  if (isNaN(leadId)) {
    return NextResponse.json({ error: "Invalid LeadId" }, { status: 400 });
  }

  const pool = await getPool();
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    await conn.query(`DELETE FROM LeadContacts WHERE LeadId = ?`, [leadId]);
    await conn.query(`DELETE FROM LeadActivities WHERE LeadId = ?`, [leadId]);
    await conn.query(`DELETE FROM LeadReminders WHERE LeadId = ?`, [leadId]);
    await conn.query(`DELETE FROM Opportunities WHERE LeadId = ?`, [leadId]);
    await conn.query(`DELETE FROM Leads WHERE LeadId = ?`, [leadId]);

    await conn.commit();

    return NextResponse.json({
      success: true,
      message: "Lead deleted successfully",
    });
  } catch (error: any) {
    await conn.rollback();
    console.error("Delete lead error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete lead" },
      { status: 500 }
    );
  } finally {
    conn.release();
  }
}
