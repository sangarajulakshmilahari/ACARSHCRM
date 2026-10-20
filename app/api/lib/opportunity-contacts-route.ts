import { NextRequest, NextResponse } from "next/server";
import { loadRecordCompanyId, resolveWriteCompanyId } from "@/app/api/lib/company-tenancy";

type AuthUser = { userId: number; roleId: number; companyId?: number | null };

type DbPool = {
  query: (sql: string, params?: any[]) => Promise<any[]>;
};

type OpportunityContactsDeps = {
  getPool: () => Promise<DbPool>;
  getAuthUser: (req: NextRequest) => Promise<AuthUser | null>;
  canUserViewLeadById: (pool: DbPool, user: AuthUser, leadId: number) => Promise<boolean>;
};

type RouteParams = {
  params: {
    leadID: string;
    OpportunityId: string;
  };
};

function parsePositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizeDate(value: any): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().split("T")[0];
}

async function authorizeParentContext(
  req: NextRequest,
  routeParams: RouteParams,
  deps: OpportunityContactsDeps
): Promise<
  | {
      pool: DbPool;
      leadId: number;
      opportunityId: number;
      authUser: AuthUser;
      companyId: number;
    }
  | NextResponse
> {
  const authUser = await deps.getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const leadId = parsePositiveInt(routeParams.params?.leadID);
  if (!leadId) {
    return NextResponse.json({ error: "Invalid Lead ID" }, { status: 400 });
  }

  const opportunityId = parsePositiveInt(routeParams.params?.OpportunityId);
  if (!opportunityId) {
    return NextResponse.json({ error: "Invalid OpportunityId" }, { status: 400 });
  }

  const pool = await deps.getPool();

  const hasLeadAccess = await deps.canUserViewLeadById(pool, authUser, leadId);
  if (!hasLeadAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [opportunityRows]: any = await pool.query(
    `
    SELECT OpportunityId
    FROM Opportunities
    WHERE OpportunityId = ?
      AND LeadId = ?
      AND COALESCE(IsDeleted, 0) = 0
    LIMIT 1
    `,
    [opportunityId, leadId]
  );

  if (!Array.isArray(opportunityRows) || opportunityRows.length === 0) {
    return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
  }

  const companyId = resolveWriteCompanyId(
    authUser.companyId,
    await loadRecordCompanyId(pool, "lead", leadId)
  );

  return { pool, leadId, opportunityId, authUser, companyId };
}

async function ensureContactBelongsToOpportunity(
  pool: DbPool,
  opportunityId: number,
  opportunityContactId: number
): Promise<boolean> {
  const [rows]: any = await pool.query(
    `
    SELECT OpportunityContactId
    FROM OpportunityContacts
    WHERE OpportunityContactId = ?
      AND OpportunityId = ?
      AND COALESCE(IsDeleted, 0) = 0
    LIMIT 1
    `,
    [opportunityContactId, opportunityId]
  );

  return Array.isArray(rows) && rows.length > 0;
}

export function createOpportunityContactHandlers(deps: OpportunityContactsDeps) {
  return {
    async GET(req: NextRequest, routeParams: RouteParams) {
      try {
        const context = await authorizeParentContext(req, routeParams, deps);
        if (context instanceof NextResponse) return context;

        const [rows] = await context.pool.query(
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
            AND COALESCE(IsDeleted, 0) = 0
          ORDER BY OpportunityContactId
          `,
          [context.opportunityId]
        );

        return NextResponse.json(rows);
      } catch (error) {
        console.error("Get opportunity contacts error:", error);
        return NextResponse.json(
          { error: "Failed to fetch opportunity contacts" },
          { status: 500 }
        );
      }
    },

    async POST(req: NextRequest, routeParams: RouteParams) {
      try {
        const context = await authorizeParentContext(req, routeParams, deps);
        if (context instanceof NextResponse) return context;

        const contacts = await req.json();

        if (!Array.isArray(contacts) || contacts.length === 0) {
          return NextResponse.json({ error: "No contacts provided" }, { status: 400 });
        }

        const insertQuery = `
          INSERT INTO OpportunityContacts (
            OpportunityId,
            CompanyId,
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
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `;

        for (const c of contacts) {
          const incomingOpportunityId = c?.OpportunityId;
          if (
            incomingOpportunityId !== undefined &&
            incomingOpportunityId !== null &&
            Number(incomingOpportunityId) !== context.opportunityId
          ) {
            return NextResponse.json(
              { error: "Payload OpportunityId does not match route" },
              { status: 400 }
            );
          }

          const values = [
            context.opportunityId,
            context.companyId,
            c?.FullName ?? null,
            c?.FirstName ?? null,
            c?.LastName ?? null,
            c?.PreferredName ?? null,
            c?.JobTitle ?? null,
            c?.Department ?? null,
            c?.SeniorityLevel ?? null,
            c?.Gender ?? null,
            normalizeDate(c?.DateOfBirth),
            c?.ProfilePictureUrl ?? null,
            c?.CompanyName ?? null,
            c?.Division ?? null,
            c?.OfficeLocation ?? null,
            c?.HeadquartersLocation ?? null,
            c?.EmployeeSize ? Number(c.EmployeeSize) : null,
            c?.Industry ?? null,
            c?.CompanyWebsite ?? null,
            c?.CompanyLinkedInPage ?? null,
            c?.WorkEmail ?? null,
            c?.PersonalEmail ?? null,
            c?.DirectPhone ?? null,
            c?.MobilePhone ?? null,
            c?.OfficePhone ?? null,
            c?.LinkedInProfileUrl ?? null,
          ];

          await context.pool.query(insertQuery, values);
        }

        return NextResponse.json({ success: true });
      } catch (error) {
        console.error("Save Opportunity Contacts Error:", error);
        return NextResponse.json(
          { error: "Failed to save opportunity contacts" },
          { status: 500 }
        );
      }
    },

    async PUT(req: NextRequest, routeParams: RouteParams) {
      try {
        const context = await authorizeParentContext(req, routeParams, deps);
        if (context instanceof NextResponse) return context;

        const contact = await req.json();
        const opportunityContactId = parsePositiveInt(contact?.OpportunityContactId);

        if (!opportunityContactId) {
          return NextResponse.json(
            { error: "OpportunityContactId is required for update" },
            { status: 400 }
          );
        }

        if (
          contact?.OpportunityId !== undefined &&
          contact?.OpportunityId !== null &&
          Number(contact.OpportunityId) !== context.opportunityId
        ) {
          return NextResponse.json(
            { error: "Payload OpportunityId does not match route" },
            { status: 400 }
          );
        }

        const contactBelongs = await ensureContactBelongsToOpportunity(
          context.pool,
          context.opportunityId,
          opportunityContactId
        );

        if (!contactBelongs) {
          return NextResponse.json({ error: "Contact not found" }, { status: 404 });
        }

        await context.pool.query(
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
            AND OpportunityId = ?
            AND COALESCE(IsDeleted, 0) = 0
          `,
          [
            contact?.FullName ?? null,
            contact?.FirstName ?? null,
            contact?.LastName ?? null,
            contact?.PreferredName ?? null,
            contact?.JobTitle ?? null,
            contact?.Department ?? null,
            contact?.SeniorityLevel ?? null,
            contact?.Gender ?? null,
            normalizeDate(contact?.DateOfBirth),
            contact?.ProfilePictureUrl ?? null,
            contact?.CompanyName ?? null,
            contact?.Division ?? null,
            contact?.OfficeLocation ?? null,
            contact?.HeadquartersLocation ?? null,
            contact?.EmployeeSize ? Number(contact.EmployeeSize) : null,
            contact?.Industry ?? null,
            contact?.CompanyWebsite ?? null,
            contact?.CompanyLinkedInPage ?? null,
            contact?.WorkEmail ?? null,
            contact?.PersonalEmail ?? null,
            contact?.DirectPhone ?? null,
            contact?.MobilePhone ?? null,
            contact?.OfficePhone ?? null,
            contact?.LinkedInProfileUrl ?? null,
            opportunityContactId,
            context.opportunityId,
          ]
        );

        return NextResponse.json({ success: true });
      } catch (error) {
        console.error("Update Opportunity Contact Error:", error);
        return NextResponse.json(
          { error: "Failed to update opportunity contact" },
          { status: 500 }
        );
      }
    },

    async DELETE(req: NextRequest, routeParams: RouteParams) {
      try {
        const context = await authorizeParentContext(req, routeParams, deps);
        if (context instanceof NextResponse) return context;

        const payload = await req.json();
        const opportunityContactId = parsePositiveInt(payload?.OpportunityContactId);

        if (!opportunityContactId) {
          return NextResponse.json(
            { error: "OpportunityContactId is required" },
            { status: 400 }
          );
        }

        const contactBelongs = await ensureContactBelongsToOpportunity(
          context.pool,
          context.opportunityId,
          opportunityContactId
        );

        if (!contactBelongs) {
          return NextResponse.json({ error: "Contact not found" }, { status: 404 });
        }

        await context.pool.query(
          `
          UPDATE OpportunityContacts
          SET IsDeleted = 1
          WHERE OpportunityContactId = ?
            AND OpportunityId = ?
            AND COALESCE(IsDeleted, 0) = 0
          `,
          [opportunityContactId, context.opportunityId]
        );

        return NextResponse.json({ success: true });
      } catch (error) {
        console.error("Delete Opportunity Contact Error:", error);
        return NextResponse.json(
          { error: "Failed to delete contact" },
          { status: 500 }
        );
      }
    },
  };
}

