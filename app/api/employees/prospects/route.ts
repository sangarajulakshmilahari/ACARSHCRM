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


  //  GET — FETCH PROSPECT LEADS

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
        lc.ContactName,
        lc.ContactTitle,
        lc.ContactEmail,
        lc.ContactPhone,
        cr.Role AS ContactRoleName,
        u.UserName AS OwnerName,
        at.AccountTypeId,
        at.Name,
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
      WHERE at.Name = 'Prospect'
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
          AccountTypeId: row.AccountTypeId,
          AccountTypeName: row.Name,
          Name: row.Name,
          LeadScore: row.LeadScore ?? 0,
          LeadScoreRating: row.LeadScoreRating ?? "COLD",
          LeadScoreBreakdown: parseScoreBreakdown(row.LeadScoreBreakdown),
          Contacts: [],
        };
      }

      // Push contact only if present
      if (row.ContactName || row.ContactEmail || row.ContactPhone) {
        grouped[row.LeadId].Contacts.push({
          ContactName: row.ContactName,
          ContactTitle: row.ContactTitle,
          ContactEmail: row.ContactEmail,
          ContactPhone: row.ContactPhone,
          ContactRoleName: row.ContactRoleName,
        });
      }
    });

    return NextResponse.json(Object.values(grouped));
  } catch (err) {
    console.error("Error fetching prospect leads:", err);
    return NextResponse.json(
      { error: "Failed to fetch prospect leads" },
      { status: 500 }
    );
  }
}


  //  POST — CREATE PROSPECT

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

    /* 2 Get AccountTypeId for 'Prospect' */
    const [atRows]: any = await conn.query(
      `SELECT AccountTypeId FROM AccountTypes WHERE Name = ?`,
      ["Prospect"]
    );
    const AccountTypeId = atRows[0]?.AccountTypeId ?? null;

    /* 3 Insert Lead */
    const [leadInsert]: any = await conn.query(
      `
      INSERT INTO Leads
        (CompanyName, CompanyLocation, LeadSource, LeadDate, LeadNotes, OwnerId, AccountTypeId, CompanyId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        CompanyName,
        CompanyLocation,
        LeadSource,
        LeadDate,
        Notes,
        OwnerId,
        AccountTypeId,
        authUser.companyId,
      ]
    );

    const LeadId = leadInsert.insertId;

    /* 4 Insert Contact (STRICT) */
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

    /* 5 Optional Reminder */
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
      { message: "Prospect created successfully", LeadId },
      { status: 200 }
    );
  } catch (err: any) {
    if (conn) await conn.rollback();
    console.error("Error creating prospect:", err);
    return NextResponse.json(
      { error: "Failed to create prospect", details: err.message },
      { status: 500 }
    );
  } finally {
    if (conn) conn.release();
  }
}
