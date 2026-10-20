import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import { getAuthUser } from "@/app/api/lib/auth";
import { canUserViewLeadById } from "@/app/api/lib/lead-access";
import { loadRecordCompanyId, resolveWriteCompanyId } from "@/app/api/lib/company-tenancy";
import {
  backfillLeadScoresOnce,
  calculateAndStoreLeadScore,
  ensureLeadScoresTable,
} from "@/app/api/lib/lead-scoring";
import { setLeadArchived } from "@/app/api/lib/lead-archive";

const deps = {
  getPool,
  getAuthUser,
  canUserViewLeadById,
};

function parseScoreBreakdown(raw: unknown): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === "object") return raw as Record<string, any>;
  if (typeof raw !== "string") return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}


//  GET LEAD DETAILS

export async function GET(
  req: NextRequest,
  { params }: { params: { leadID: string } }
) {
  try {
    const authUser = await deps.getAuthUser(req);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const leadId = Number(params.leadID);
    if (isNaN(leadId)) {
      return NextResponse.json({ error: "Invalid LeadId" }, { status: 400 });
    }

    const pool = await deps.getPool();
    const hasAccess = await deps.canUserViewLeadById(pool, authUser, leadId);
    if (!hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const conn = await pool.getConnection();

    try {
      await ensureLeadScoresTable(conn);
      await backfillLeadScoresOnce(conn);

      /* 1. Lead Basic Details */
      const leadDetailsQuery = `
        SELECT
  l.LeadId,
  l.CompanyName,
  l.CompanyLocation,
  l.LeadSource,
  DATE_FORMAT(l.LeadDate, '%Y-%m-%d') AS LeadDate,
  l.LeadNotes,
  lscr.Score AS LeadScore,
  lscr.Rating AS LeadScoreRating,
  lscr.Breakdown AS LeadScoreBreakdown,
  latestStatus.StatusName,
  l.AccountTypeId,
  at.Name AS AccountTypeName,
  u.UserName AS OwnerName
FROM Leads l
LEFT JOIN Users u ON l.OwnerId = u.UserId
LEFT JOIN AccountTypes at
  ON l.AccountTypeId = at.AccountTypeId
LEFT JOIN LeadScores lscr
  ON lscr.LeadId = l.LeadId
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
      `;

      let [leadRows]: any = await conn.query(
        leadDetailsQuery,
        [leadId]
      );

      if (Array.isArray(leadRows) && leadRows[0] && leadRows[0].LeadScore == null) {
        try {
          await calculateAndStoreLeadScore(conn, leadId);
          [leadRows] = await conn.query(leadDetailsQuery, [leadId]);
        } catch (error) {
          console.error(`[lead-scoring] on-demand calculate failed for lead ${leadId}:`, error);
        }
      }

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
          lc.ContactPhone,
          lc.ContactNotes,
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
        LeadScore: leadRows[0].LeadScore ?? 0,
        LeadScoreRating: leadRows[0].LeadScoreRating ?? "COLD",
        LeadScoreBreakdown: parseScoreBreakdown(leadRows[0].LeadScoreBreakdown),
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
  const authUser = await deps.getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  const pool = await deps.getPool();
  const hasAccess = await deps.canUserViewLeadById(pool, authUser, leadId);
  if (!hasAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const companyId = resolveWriteCompanyId(
    authUser.companyId,
    await loadRecordCompanyId(pool, "lead", leadId)
  );

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
        AND CompanyId = ?
      `,
      [
        CompanyName || null,
        CompanyLocation || null,
        LeadSource || null,
        LeadDate || null,
        LeadNotes || null,
        ownerId,
        leadId,
        companyId,
      ]
    );

    /* Contacts: update existing, insert new, delete removed (without breaking FK) */
    if (Array.isArray(Contacts)) {
      const [existingRows]: any = await conn.query(
        `SELECT LeadContactID FROM LeadContacts WHERE LeadId = ? AND CompanyId = ?`,
        [leadId, companyId]
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
              ContactNotes = ?,
              ContactRoleId = ?,
              LinkedInProfile = ?,
              LinkedInRequestSent = ?,
              LinkedInRequestAccepted = ?,
              EmailSent = ?
            WHERE LeadId = ? AND LeadContactID = ? AND CompanyId = ?
            `,
            [
              c.ContactName || null,
              c.ContactEmail || null,
              c.ContactTitle || null,
              c.ContactPhone || null,
              c.ContactNotes || null,
              roleId,
              c.LinkedInProfile || null,
              c.LinkedInRequestSent ? 1 : 0,
              c.LinkedInRequestAccepted ? 1 : 0,
              c.EmailSent ? 1 : 0,
              leadId,
              maybeContactId,
              companyId,
            ]
          );

          continue;
        }

        await conn.query(
          `
          INSERT INTO LeadContacts
            (LeadId, CompanyId, ContactName, ContactEmail, ContactTitle, ContactPhone, ContactNotes, ContactRoleId,
             LinkedInProfile, LinkedInRequestSent, LinkedInRequestAccepted, EmailSent)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            leadId,
            resolveWriteCompanyId(authUser.companyId, await loadRecordCompanyId(conn, "lead", leadId)),
            c.ContactName || null,
            c.ContactEmail || null,
            c.ContactTitle || null,
            c.ContactPhone || null,
            c.ContactNotes || null,
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
          WHERE LeadId = ? AND CompanyId = ? AND ContactId IN (${placeholders})
          `,
          [leadId, companyId, ...deletedContactIds]
        );

        await conn.query(
          `DELETE FROM LeadContacts WHERE LeadId = ? AND CompanyId = ? AND LeadContactID IN (${placeholders})`,
          [leadId, companyId, ...deletedContactIds]
        );
      }
    }

    await calculateAndStoreLeadScore(conn, leadId);

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
  const authUser = await deps.getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const leadId = Number(params.leadID);
  if (isNaN(leadId)) {
    return NextResponse.json({ error: "Invalid LeadId" }, { status: 400 });
  }

  const pool = await deps.getPool();
  const hasAccess = await deps.canUserViewLeadById(pool, authUser, leadId);
  if (!hasAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const archived = await setLeadArchived(conn, leadId, true);
    if (!archived) {
      await conn.rollback();
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    await conn.commit();

    return NextResponse.json({
      success: true,
      message: "Lead archived successfully",
      IsArchived: 1,
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
