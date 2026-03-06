// app/api/leads/prospects/route.ts

import { NextResponse } from "next/server";
import { getPool } from "../../../../config/db";


  //  GET → FETCH PROSPECT / ACCOUNT LEADS

export async function GET() {
  try {
    const pool = await getPool();

    const [rows]: any = await pool.query(`
      SELECT
        l.LeadId,
        l.CompanyName,
        l.CompanyLocation,
        l.LeadSource,
        l.LeadDate,
        l.LeadNotes,
        ls.StatusName,
        lc.ContactName,
        lc.ContactTitle,
        lc.ContactEmail,
        lc.ContactPhone,
        cr.Role AS ContactRoleName,
        u.UserName AS OwnerName,
        at.AccountTypeId,
        at.Name
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
      WHERE at.Name = 'Account'
    `);

    const grouped: any = {};

    rows.forEach((row: any) => {
      if (!grouped[row.LeadId]) {
        grouped[row.LeadId] = {
          LeadId: row.LeadId,
          CompanyName: row.CompanyName,
          CompanyLocation: row.CompanyLocation,
          LeadSource: row.LeadSource,
          LeadDate: row.LeadDate,
          LeadNotes: row.LeadNotes,
          StatusName: row.StatusName,
          OwnerName: row.OwnerName,
          AccountTypeId: row.AccountTypeId,
          Name: row.Name,
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


  //  POST → CREATE ACCOUNT + CONTACT (+ OPTIONAL REMINDER)

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

    
      //  1 Get StatusId
   
    const [statusRows]: any = await conn.query(
      `SELECT StatusId FROM LeadStatuses WHERE StatusName = ?`,
      [StatusName]
    );
    const StatusId = statusRows[0]?.StatusId ?? 1;

   
      //  2 Get OwnerId
    
    const [ownerRows]: any = await conn.query(
      `SELECT UserId FROM Users WHERE UserName = ?`,
      [OwnerName]
    );
    const OwnerId = ownerRows[0]?.UserId ?? null;

   
      //  3 Get AccountTypeId (Account)
    
    const [atRows]: any = await conn.query(
      `SELECT AccountTypeId FROM AccountTypes WHERE Name = ?`,
      ["Account"]
    );
    const AccountTypeId = atRows[0]?.AccountTypeId ?? null;

    
      //  4 Insert Lead
   
    const [leadInsert]: any = await conn.query(
      `
      INSERT INTO Leads
        (CompanyName, CompanyLocation, LeadSource, LeadDate, LeadNotes, StatusId, OwnerId, AccountTypeId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        CompanyName,
        CompanyLocation,
        LeadSource,
        LeadDate,
        Notes,
        StatusId,
        OwnerId,
        AccountTypeId,
      ]
    );

    const LeadId = leadInsert.insertId;

    
      //  5 Insert Contact (STRICT)
   
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

    
      //  6 Optional Reminder
    
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
      { message: "Account created successfully", LeadId },
      { status: 200 }
    );
  } catch (err: any) {
    if (conn) await conn.rollback();
    console.error("Error creating account:", err);
    return NextResponse.json(
      { error: "Failed to create account", details: err.message },
      { status: 500 }
    );
  } finally {
    if (conn) conn.release();
  }
}
