import { NextRequest, NextResponse } from "next/server";
import { getPool } from "../../../../config/db";
import { getAuthUser } from "../../lib/auth";
import { buildLeadOwnerVisibilityClause } from "@/app/api/lib/lead-access";
import {
  backfillLeadScoresOnce,
  calculateAndStoreLeadScore,
  ensureLeadScoresTable,
} from "@/app/api/lib/lead-scoring";
import {
  ensureLeadArchiveColumn,
  leadArchiveWhereClause,
  setLeadArchived,
  wantsArchivedList,
} from "@/app/api/lib/lead-archive";

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


  //  GET — FETCH LEADS

export async function GET(req: NextRequest) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const pool = await getPool();
    await ensureLeadScoresTable(pool);
    await ensureLeadArchiveColumn(pool);
    await backfillLeadScoresOnce(pool);

    const visibility = buildLeadOwnerVisibilityClause(authUser, "l");
    const archived = wantsArchivedList(req.url);
    const baseQuery = `
      SELECT
        l.LeadId,
        l.CompanyName,
        l.CompanyLocation,
        l.LeadSource,
        l.LeadDate,
        l.CreatedOn,
        l.IsArchived,
        l.LeadNotes,
        las.StatusName AS StatusName,
        latestActivity.ActivityId AS LatestActivityId,
        latestActivity.Notes AS LatestActivityNotes,
        lc.LeadContactID,
        lc.ContactName,
        lc.ContactTitle,
        lc.ContactEmail,
        lc.ContactPhone,
        lc.ContactNotes,
        cr.Role AS ContactRoleName,
        u.UserName AS OwnerName,
        at.AccountTypeId,
        at.Name AS AccountTypeName,
        lscr.Score AS LeadScore,
        lscr.Rating AS LeadScoreRating,
        lscr.Breakdown AS LeadScoreBreakdown
      FROM Leads l
      LEFT JOIN LeadContacts lc
        ON lc.LeadId = l.LeadId
      LEFT JOIN ContactRoles cr
        ON lc.ContactRoleId = cr.RoleId
      LEFT JOIN Users u
        ON l.OwnerId = u.UserId
      LEFT JOIN AccountTypes at
        ON l.AccountTypeId = at.AccountTypeId
      LEFT JOIN (
        SELECT LeadId, ActivityId, StatusId, Notes
        FROM (
          SELECT
            la.LeadId,
            la.ActivityId,
            la.StatusId,
            la.Notes,
            ROW_NUMBER() OVER (
              PARTITION BY la.LeadId
              ORDER BY la.ActivityDate DESC, la.CreatedOn DESC, la.ActivityId DESC
            ) AS rn
          FROM LeadActivities la
        ) rankedActivities
        WHERE rn = 1
      ) latestActivity
        ON latestActivity.LeadId = l.LeadId
      LEFT JOIN LeadStatuses las
        ON latestActivity.StatusId = las.StatusId
      LEFT JOIN LeadScores lscr
        ON lscr.LeadId = l.LeadId
      WHERE (at.Name IS NULL OR at.Name NOT IN ('Prospect','Account'))
      AND ${leadArchiveWhereClause(archived)}
      AND ${visibility.clause}
      ORDER BY l.CreatedOn DESC
    `;

    let [rows]: any = await pool.query(
      baseQuery,
      visibility.params
    );

    const missingScoreLeadIds = [...new Set(
      (Array.isArray(rows) ? rows : [])
        .filter((row: any) => row?.LeadScore == null)
        .map((row: any) => Number(row?.LeadId))
        .filter((id: number) => Number.isFinite(id) && id > 0)
    )];

    if (missingScoreLeadIds.length) {
      for (const leadId of missingScoreLeadIds) {
        try {
          await calculateAndStoreLeadScore(pool, leadId);
        } catch (error) {
          console.error(`[lead-scoring] on-demand calculate failed for lead ${leadId}:`, error);
        }
      }
      [rows] = await pool.query(baseQuery, visibility.params);
    }
 
    const grouped: any = {};
 
    rows.forEach((row: any) => {
      if (!grouped[row.LeadId]) {
        grouped[row.LeadId] = {
          LeadId: row.LeadId,
          CompanyName: row.CompanyName,
          CompanyLocation: row.CompanyLocation,
          LeadSource: row.LeadSource,
          LeadDate: row.LeadDate,
          CreatedOn: row.CreatedOn,
          IsArchived: Number(row.IsArchived || 0),
          LeadNotes: row.LeadNotes,
          StatusName: row.StatusName,
          LatestActivityId: row.LatestActivityId,
          LatestActivityNotes: row.LatestActivityNotes,
          OwnerName: row.OwnerName,
          AccountTypeId: row.AccountTypeId ?? 10,
          AccountTypeName: row.AccountTypeName ?? "Lead",
          LeadScore: row.LeadScore ?? 0,
          LeadScoreRating: row.LeadScoreRating ?? "COLD",
          LeadScoreBreakdown: parseScoreBreakdown(row.LeadScoreBreakdown),
          Contacts: [],
        };
      }
 
      if (row.ContactName || row.ContactEmail || row.ContactPhone) {
        grouped[row.LeadId].Contacts.push({
          LeadContactID: row.LeadContactID,
          ContactName: row.ContactName,
          ContactTitle: row.ContactTitle,
          ContactEmail: row.ContactEmail,
          ContactPhone: row.ContactPhone,
          ContactNotes: row.ContactNotes,
          ContactRoleName: row.ContactRoleName,
        });
      }
    });
 
    return NextResponse.json(Object.values(grouped));
  } catch (err) {
    console.error("Error fetching leads:", err);
    return NextResponse.json(
      { error: "Failed to fetch leads" },
      { status: 500 }
    );
  }
}
 
 
  //  POST — CREATE LEAD
 
export async function POST(req: NextRequest) {
  let conn: any;
 
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!authUser.companyId) {
      return NextResponse.json({ error: "Company membership required" }, { status: 403 });
    }

    const body = await req.json();
 
    const {
      CompanyName,
      CompanyLocation,
      LeadSource,
      LeadDate,
      StatusName,
      OwnerName,
      Notes,
      ContactName,
      ContactEmail,
      ContactPhone,
      ContactTitle,
      ContactNotes,
      ContactRoleName,
      LinkedInURL,
      LinkedInProfile,
      LinkedInRequestSent,
      LinkedInRequestAccepted,
      AddReminder,
    } = body;

    const normalizedLinkedInProfile = String(
      LinkedInProfile || LinkedInURL || ""
    )
      .trim()
      .replace(/^https?:\/\//i, "")
      .replace(/\/$/, "") || null;
 
    const pool = await getPool();
    conn = await pool.getConnection();
    await conn.beginTransaction();
 
    /* 1 Get OwnerId */
    const [ownerRows]: any = await conn.query(
      `SELECT UserId FROM Users WHERE UserName = ?`,
      [OwnerName]
    );
    const OwnerId = ownerRows[0]?.UserId ?? null;

    /* 2 Insert Lead */
    const [leadInsert]: any = await conn.query(
      `
      INSERT INTO Leads
        (CompanyName, CompanyLocation, LeadSource, LeadDate, LeadNotes, OwnerId, CompanyId)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        CompanyName,
        CompanyLocation,
        LeadSource,
        LeadDate,
        Notes,
        OwnerId,
        authUser.companyId,
      ]
    );
 
    const LeadId = leadInsert.insertId;
 
    /* 3 Insert Contact (STRICT) */
    if (ContactName || ContactEmail || ContactPhone) {
      if (!ContactRoleName) {
        await conn.rollback();
        return NextResponse.json(
          { error: "Contact role is required" },
          { status: 400 }
        );
      }
 
      const [roleRows]: any = await conn.query(
        `SELECT RoleId FROM ContactRoles WHERE Role = ?`,
        [ContactRoleName]
      );
 
      if (!roleRows.length) {
        await conn.rollback();
        return NextResponse.json(
          { error: "Invalid Contact Role" },
          { status: 400 }
        );
      }
 
      const ContactRoleId = roleRows[0].RoleId;
 
      await conn.query(
        `
        INSERT INTO LeadContacts
          (
            LeadId,
            CompanyId,
            ContactName,
            ContactEmail,
            ContactPhone,
            ContactTitle,
            ContactNotes,
            ContactRoleId,
            LinkedInProfile,
            LinkedInRequestSent,
            LinkedInRequestAccepted,
            EmailSent
          )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          LeadId,
          authUser.companyId,
          ContactName,
          ContactEmail,
          ContactPhone,
          ContactTitle,
          ContactNotes || null,
          ContactRoleId,
          normalizedLinkedInProfile,
          LinkedInRequestSent ? 1 : 0,
          LinkedInRequestAccepted ? 1 : 0,
          0,
        ]
      );
    }
 
    /* 4 Optional Reminder */
    if (AddReminder) {
      await conn.query(
        `
        INSERT INTO LeadReminders
          (LeadId, CompanyId, ReminderDate, ReminderNote, Status, NotificationChannels, CreatedBy, IsCompleted, EmailSent, EmailProcessing)
        VALUES (?, ?, UTC_TIMESTAMP(), 'Follow up', 'Pending', 'Email', ?, 0, 0, 0)
        `,
        [LeadId, authUser.companyId, authUser.userId]
      );
    }

    await calculateAndStoreLeadScore(conn, Number(LeadId));
 
    await conn.commit();
 
    return NextResponse.json(
      { message: "Lead created successfully", LeadId },
      { status: 200 }
    );
  } catch (err: any) {
    if (conn) await conn.rollback();
    console.error("Error creating lead:", err);
    return NextResponse.json(
      { error: "Failed to create lead", details: err.message },
      { status: 500 }
    );
  } finally {
    if (conn) conn.release();
  }
}
 
 
  //  DELETE — ARCHIVE LEAD
 
export async function DELETE(req: Request) {
  let conn: any;
 
  try {
    const { searchParams } = new URL(req.url);
    const leadId = Number(searchParams.get("leadId"));
 
    if (isNaN(leadId)) {
      return NextResponse.json(
        { error: "LeadId is required" },
        { status: 400 }
      );
    }
 
    const pool = await getPool();
    conn = await pool.getConnection();
    await conn.beginTransaction();
 
    // Delete child records first
    const archived = await setLeadArchived(conn, leadId, true);
    if (!archived) {
      await conn.rollback();
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }
 
    await conn.commit();
 
    return NextResponse.json({ message: "Lead archived successfully", IsArchived: 1 });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error("Archive lead error:", err);
    return NextResponse.json(
      { error: "Failed to archive lead" },
      { status: 500 }
    );
  } finally {
    if (conn) conn.release();
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const leadId = Number(searchParams.get("leadId"));
    if (!Number.isFinite(leadId) || leadId <= 0) {
      return NextResponse.json({ error: "LeadId is required" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const isArchived = Boolean(body?.isArchived ?? body?.IsArchived);
    const pool = await getPool();
    const updated = await setLeadArchived(pool, leadId, isArchived);
    if (!updated) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    return NextResponse.json({
      message: isArchived ? "Lead archived successfully" : "Lead restored successfully",
      IsArchived: isArchived ? 1 : 0,
    });
  } catch (err) {
    console.error("Update lead archive error:", err);
    return NextResponse.json(
      { error: "Failed to update archive status" },
      { status: 500 }
    );
  }
}
 
 
