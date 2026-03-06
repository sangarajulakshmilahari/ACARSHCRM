import { NextResponse } from "next/server";
import { getPool } from "@/config/db";


  //  Helpers

const normalizeDate = (value: any) => {
  if (!value) return null;
  return new Date(value).toISOString().split("T")[0];
};


  //  GET — FETCH CONTACTS

export async function GET(
  req: Request,
  { params }: { params: { OpportunityId: string } }
) {
  try {
    const OpportunityId = Number(params.OpportunityId);

    if (isNaN(OpportunityId)) {
      return NextResponse.json(
        { error: "Invalid OpportunityId" },
        { status: 400 }
      );
    }

    const pool = await getPool();

    const [rows] = await pool.query(
      `
      SELECT
        OpportunityContactId,
        OpportunityId,

        FullName,
        FirstName,
        LastName,
        PreferredName,
        JobTitle,
        Department,
        SeniorityLevel,
        Gender,
        DateOfBirth,
        ProfilePictureUrl,

        CompanyName,
        Division,
        OfficeLocation,
        HeadquartersLocation,
        EmployeeSize,
        Industry,
        CompanyWebsite,
        CompanyLinkedInPage,

        WorkEmail,
        PersonalEmail,
        DirectPhone,
        MobilePhone,
        OfficePhone,
        LinkedInProfileUrl
      FROM OpportunityContacts
      WHERE OpportunityId = ?
        AND IsDeleted = 0
      ORDER BY OpportunityContactId
      `,
      [OpportunityId]
    );

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Get opportunity contacts error:", error);
    return NextResponse.json(
      { error: "Failed to fetch opportunity contacts" },
      { status: 500 }
    );
  }
}


  //  POST — SAVE CONTACTS

export async function POST(
  req: Request,
  { params }: { params: { OpportunityId: string } }
) {
  try {
    const OpportunityId = Number(params.OpportunityId);

    if (!OpportunityId) {
      return NextResponse.json(
        { error: "Invalid OpportunityId" },
        { status: 400 }
      );
    }

    const contacts = await req.json();

    if (!Array.isArray(contacts) || contacts.length === 0) {
      return NextResponse.json(
        { error: "No contacts provided" },
        { status: 400 }
      );
    }

    const pool = await getPool();

    const insertQuery = `
      INSERT INTO OpportunityContacts (
        OpportunityId,
        FullName,
        FirstName,
        LastName,
        PreferredName,
        JobTitle,
        Department,
        SeniorityLevel,
        Gender,
        DateOfBirth,
        ProfilePictureUrl,
        CompanyName,
        Division,
        OfficeLocation,
        HeadquartersLocation,
        EmployeeSize,
        Industry,
        CompanyWebsite,
        CompanyLinkedInPage,
        WorkEmail,
        PersonalEmail,
        DirectPhone,
        MobilePhone,
        OfficePhone,
        LinkedInProfileUrl
      )
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `;

    for (const c of contacts) {
      const values = [
        OpportunityId,

        c.FullName ?? null,
        c.FirstName ?? null,
        c.LastName ?? null,
        c.PreferredName ?? null,

        c.JobTitle ?? null,
        c.Department ?? null,
        c.SeniorityLevel ?? null,
        c.Gender ?? null,
        normalizeDate(c.DateOfBirth),

        c.ProfilePictureUrl ?? null,

        c.CompanyName ?? null,
        c.Division ?? null,
        c.OfficeLocation ?? null,
        c.HeadquartersLocation ?? null,
        c.EmployeeSize ? Number(c.EmployeeSize) : null,
        c.Industry ?? null,
        c.CompanyWebsite ?? null,
        c.CompanyLinkedInPage ?? null,

        c.WorkEmail ?? null,
        c.PersonalEmail ?? null,
        c.DirectPhone ?? null,
        c.MobilePhone ?? null,
        c.OfficePhone ?? null,

        c.LinkedInProfileUrl ?? null
      ];

      await pool.query(insertQuery, values);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Save Opportunity Contacts Error:", err);
    return NextResponse.json(
      { error: "Failed to save opportunity contacts" },
      { status: 500 }
    );
  }
}


  //  PUT — UPDATE CONTACT

export async function PUT(
  req: Request,
  { params }: { params: { opportunityId: string } }
) {
  const contact = await req.json();
  const pool = await getPool();

  if (!contact.OpportunityContactId) {
    return NextResponse.json(
      { error: "OpportunityContactId is required for update" },
      { status: 400 }
    );
  }

  await pool.query(
    `
    UPDATE OpportunityContacts
    SET
      FullName = COALESCE(?, FullName),
      FirstName = COALESCE(?, FirstName),
      LastName = COALESCE(?, LastName),
      PreferredName = COALESCE(?, PreferredName),

      JobTitle = COALESCE(?, JobTitle),
      Department = COALESCE(?, Department),
      SeniorityLevel = COALESCE(?, SeniorityLevel),
      Gender = COALESCE(?, Gender),
      DateOfBirth = COALESCE(?, DateOfBirth),

      ProfilePictureUrl = COALESCE(?, ProfilePictureUrl),

      CompanyName = COALESCE(?, CompanyName),
      Division = COALESCE(?, Division),
      OfficeLocation = COALESCE(?, OfficeLocation),
      HeadquartersLocation = COALESCE(?, HeadquartersLocation),
      EmployeeSize = COALESCE(?, EmployeeSize),
      Industry = COALESCE(?, Industry),
      CompanyWebsite = COALESCE(?, CompanyWebsite),
      CompanyLinkedInPage = COALESCE(?, CompanyLinkedInPage),

      WorkEmail = COALESCE(?, WorkEmail),
      PersonalEmail = COALESCE(?, PersonalEmail),
      DirectPhone = COALESCE(?, DirectPhone),
      MobilePhone = COALESCE(?, MobilePhone),
      OfficePhone = COALESCE(?, OfficePhone),

      LinkedInProfileUrl = COALESCE(?, LinkedInProfileUrl)
    WHERE OpportunityContactId = ?
    `,
    [
      contact.FullName ?? null,
      contact.FirstName ?? null,
      contact.LastName ?? null,
      contact.PreferredName ?? null,

      contact.JobTitle ?? null,
      contact.Department ?? null,
      contact.SeniorityLevel ?? null,
      contact.Gender ?? null,
      normalizeDate(contact.DateOfBirth),

      contact.ProfilePictureUrl ?? null,

      contact.CompanyName ?? null,
      contact.Division ?? null,
      contact.OfficeLocation ?? null,
      contact.HeadquartersLocation ?? null,
      contact.EmployeeSize ? Number(contact.EmployeeSize) : null,
      contact.Industry ?? null,
      contact.CompanyWebsite ?? null,
      contact.CompanyLinkedInPage ?? null,

      contact.WorkEmail ?? null,
      contact.PersonalEmail ?? null,
      contact.DirectPhone ?? null,
      contact.MobilePhone ?? null,
      contact.OfficePhone ?? null,

      contact.LinkedInProfileUrl ?? null,
      contact.OpportunityContactId
    ]
  );

  return NextResponse.json({ success: true });
}


  //  DELETE — SOFT DELETE CONTACT

export async function DELETE(
  req: Request
) {
  try {
    const { OpportunityContactId } = await req.json();

    if (!OpportunityContactId) {
      return NextResponse.json(
        { error: "OpportunityContactId is required" },
        { status: 400 }
      );
    }

    const pool = await getPool();

    await pool.query(
      `
      UPDATE OpportunityContacts
      SET IsDeleted = 1
      WHERE OpportunityContactId = ?
      `,
      [OpportunityContactId]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete Opportunity Contact Error:", error);
    return NextResponse.json(
      { error: "Failed to delete contact" },
      { status: 500 }
    );
  }
}
