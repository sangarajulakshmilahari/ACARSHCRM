import { NextRequest, NextResponse } from "next/server";
import { getPool } from "../../../../config/db";
import { getAuthUser } from "../../lib/auth";


  //  GET — FETCH LEADS

export async function GET(req: NextRequest) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const pool = await getPool();

    const isAdmin = authUser.roleId === 1;
    const baseQuery = `
      SELECT
        l.LeadId,
        l.CompanyName,
        l.CompanyLocation,
        l.LeadSource,
        l.LeadDate,
        l.CreatedOn,
        l.LeadNotes,
        COALESCE(las.StatusName, ls.StatusName) AS StatusName,
        latestActivity.ActivityId AS LatestActivityId,
        latestActivity.Notes AS LatestActivityNotes,
        lc.ContactName,
        lc.ContactTitle,
        lc.ContactEmail,
        lc.ContactPhone,
        cr.Role AS ContactRoleName,
        u.UserName AS OwnerName,
        at.AccountTypeId,
        at.Name AS AccountTypeName
      FROM Leads l
      LEFT JOIN LeadStatuses ls
        ON l.StatusId = ls.StatusId
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
      WHERE (at.Name IS NULL OR at.Name NOT IN ('Prospect','Account'))
      ${isAdmin ? "" : "AND l.OwnerId = ?"}
    `;

    const [rows]: any = await pool.query(
      baseQuery,
      isAdmin ? [] : [authUser.userId]
    );
 
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
          LeadNotes: row.LeadNotes,
          StatusName: row.StatusName,
          LatestActivityId: row.LatestActivityId,
          LatestActivityNotes: row.LatestActivityNotes,
          OwnerName: row.OwnerName,
          Contacts: [],
        };
      }
 
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
    console.error("Error fetching leads:", err);
    return NextResponse.json(
      { error: "Failed to fetch leads" },
      { status: 500 }
    );
  }
}
 
 
  //  POST — CREATE LEAD
 
export async function POST(req: Request) {
  let conn: any;
 
  try {
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
      ContactRoleName,
      AddReminder,
    } = body;
 
    const pool = await getPool();
    conn = await pool.getConnection();
    await conn.beginTransaction();
 
    /* 1 Get StatusId */
    const [statusRows]: any = await conn.query(
      `SELECT StatusId FROM LeadStatuses WHERE StatusName = ?`,
      [StatusName]
    );
    const StatusId = statusRows[0]?.StatusId ?? 1;
 
    /* 2 Get OwnerId */
    const [ownerRows]: any = await conn.query(
      `SELECT UserId FROM Users WHERE UserName = ?`,
      [OwnerName]
    );
    const OwnerId = ownerRows[0]?.UserId ?? null;
 
    /* 3 Insert Lead */
    const [leadInsert]: any = await conn.query(
      `
      INSERT INTO Leads
        (CompanyName, CompanyLocation, LeadSource, LeadDate, LeadNotes, StatusId, OwnerId)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        CompanyName,
        CompanyLocation,
        LeadSource,
        LeadDate,
        Notes,
        StatusId,
        OwnerId,
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
          (LeadId, ContactName, ContactEmail, ContactPhone, ContactTitle, ContactRoleId)
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
          LeadId,
          ContactName,
          ContactEmail,
          ContactPhone,
          ContactTitle,
          ContactRoleId,
        ]
      );
    }
 
    /* 5 Optional Reminder */
    if (AddReminder) {
      await conn.query(
        `
        INSERT INTO Reminders (LeadId, ReminderDate)
        VALUES (?, NOW())
        `,
        [LeadId]
      );
    }
 
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
 
 
  //  DELETE — DELETE LEAD
 
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
    await conn.query(`DELETE FROM LeadContacts WHERE LeadId = ?`, [leadId]);
    await conn.query(`DELETE FROM LeadActivities WHERE LeadId = ?`, [leadId]);
    await conn.query(`DELETE FROM LeadReminders WHERE LeadId = ?`, [leadId]);
    await conn.query(`DELETE FROM Opportunities WHERE LeadId = ?`, [leadId]);
    await conn.query(`DELETE FROM Leads WHERE LeadId = ?`, [leadId]);
 
    await conn.commit();
 
    return NextResponse.json({ message: "Lead deleted successfully" });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error("Delete lead error:", err);
    return NextResponse.json(
      { error: "Failed to delete lead" },
      { status: 500 }
    );
  } finally {
    if (conn) conn.release();
  }
}
 
 
