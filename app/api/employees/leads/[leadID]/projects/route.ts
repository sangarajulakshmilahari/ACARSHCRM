import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import { getAuthUser } from "../../../../lib/auth";

type ProjectResourceInput = {
  employeeId?: string | number | null;
  resourceName?: string | null;
  title?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  reportingManager?: string | null;
  reportingManagerTitle?: string | null;
};

type ProjectContactInput = {
  contactName?: string | null;
  ContactName?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
};

const JSON_PREFIX = "__JSON__";

function hasValue(value: any): boolean {
  return value !== undefined && value !== null && String(value).trim().length > 0;
}

function encodeWithPrefix(payload: Record<string, any>): string {
  return `${JSON_PREFIX}${JSON.stringify(payload)}`;
}

function decodeWithPrefix(value: any): Record<string, any> | null {
  if (!hasValue(value)) return null;
  const text = String(value);
  if (!text.startsWith(JSON_PREFIX)) return null;
  try {
    const parsed = JSON.parse(text.slice(JSON_PREFIX.length));
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeProjectContacts(input: any): Array<{
  contactName: string;
  title: string | null;
  email: string | null;
  phone: string | null;
}> {
  if (!Array.isArray(input)) return [];

  return input
    .map((value: string | ProjectContactInput) => {
      if (typeof value === "string") {
        return {
          contactName: value.trim(),
          title: null,
          email: null,
          phone: null,
        };
      }

      const contactName = String(value?.contactName ?? value?.ContactName ?? "").trim();
      const title = hasValue(value?.title) ? String(value?.title).trim() : null;
      const email = hasValue(value?.email) ? String(value?.email).trim() : null;
      const phone = hasValue(value?.phone) ? String(value?.phone).trim() : null;

      return {
        contactName,
        title,
        email,
        phone,
      };
    })
    .filter((contact) => contact.contactName.length > 0);
}

function normalizeProjectResources(input: any): Array<{
  employeeId: string | null;
  resourceName: string;
  title: string | null;
  startDate: string | null;
  endDate: string | null;
  reportingManager: string | null;
  reportingManagerTitle: string | null;
}> {
  if (!Array.isArray(input)) return [];

  return (input as ProjectResourceInput[])
    .map((resource) => {
      const resourceName = String(resource?.resourceName ?? "").trim();
      const employeeId =
        resource?.employeeId === null || resource?.employeeId === undefined
          ? null
          : String(resource.employeeId).trim() || null;

      return {
        employeeId,
        resourceName,
        title: hasValue(resource?.title) ? String(resource.title).trim() : null,
        startDate: hasValue(resource?.startDate) ? String(resource.startDate).trim() : null,
        endDate: hasValue(resource?.endDate) ? String(resource.endDate).trim() : null,
        reportingManager: hasValue(resource?.reportingManager)
          ? String(resource.reportingManager).trim()
          : null,
        reportingManagerTitle: hasValue(resource?.reportingManagerTitle)
          ? String(resource.reportingManagerTitle).trim()
          : null,
      };
    })
    .filter((resource) => resource.resourceName.length > 0);
}

function serializeProjectContact(contact: {
  contactName: string;
  title: string | null;
  email: string | null;
  phone: string | null;
}): string {
  const hasExtendedFields =
    hasValue(contact.title) || hasValue(contact.email) || hasValue(contact.phone);

  if (!hasExtendedFields) {
    return contact.contactName;
  }

  return encodeWithPrefix({
    contactName: contact.contactName,
    title: contact.title,
    email: contact.email,
    phone: contact.phone,
  });
}

function parseStoredProjectContact(value: any): {
  contactName: string;
  title: string | null;
  email: string | null;
  phone: string | null;
} {
  const parsed = decodeWithPrefix(value);
  if (parsed) {
    return {
      contactName: String(parsed.contactName ?? "").trim(),
      title: hasValue(parsed.title) ? String(parsed.title).trim() : null,
      email: hasValue(parsed.email) ? String(parsed.email).trim() : null,
      phone: hasValue(parsed.phone) ? String(parsed.phone).trim() : null,
    };
  }

  return {
    contactName: String(value ?? "").trim(),
    title: null,
    email: null,
    phone: null,
  };
}

function serializeProjectResource(resource: {
  employeeId: string | null;
  resourceName: string;
  title: string | null;
  startDate: string | null;
  endDate: string | null;
  reportingManager: string | null;
  reportingManagerTitle: string | null;
}): string {
  // If an employee is selected/mapped, always persist EmployeeId in DB.
  // UI can still display employee name by joining employee master on GET.
  if (hasValue(resource.employeeId)) {
    return String(resource.employeeId).trim();
  }

  return String(resource.resourceName || "").trim();
}

function parseStoredProjectResource(value: any, fallbackEmployeeName?: string | null): {
  employeeId: string | null;
  employeeName: string;
  title: string | null;
  startDate: string | null;
  endDate: string | null;
  reportingManager: string | null;
  reportingManagerTitle: string | null;
} {
  const parsed = decodeWithPrefix(value);
  if (parsed) {
    const employeeId = hasValue(parsed.employeeId) ? String(parsed.employeeId).trim() : null;
    const resourceName = hasValue(parsed.resourceName)
      ? String(parsed.resourceName).trim()
      : employeeId || String(fallbackEmployeeName ?? "").trim();

    return {
      employeeId,
      employeeName: resourceName,
      title: hasValue(parsed.title) ? String(parsed.title).trim() : null,
      startDate: hasValue(parsed.startDate) ? String(parsed.startDate).trim() : null,
      endDate: hasValue(parsed.endDate) ? String(parsed.endDate).trim() : null,
      reportingManager: hasValue(parsed.reportingManager)
        ? String(parsed.reportingManager).trim()
        : null,
      reportingManagerTitle: hasValue(parsed.reportingManagerTitle)
        ? String(parsed.reportingManagerTitle).trim()
        : null,
    };
  }

  const textValue = String(value ?? "").trim();
  return {
    employeeId: textValue || null,
    employeeName: String(fallbackEmployeeName ?? "").trim() || textValue,
    title: null,
    startDate: null,
    endDate: null,
    reportingManager: null,
    reportingManagerTitle: null,
  };
}

async function replaceProjectContacts(
  conn: any,
  projectId: number,
  contacts: Array<{ contactName: string; title: string | null; email: string | null; phone: string | null }>
) {
  await conn.query(`DELETE FROM ProjectContacts WHERE ProjectId = ?`, [projectId]);

  const [contactTypeRows]: any = await conn.query(
    `
    SELECT COALESCE(MIN(ContactTypeId), 1) AS ContactTypeId
    FROM ProjectContacts
    WHERE ContactTypeId IS NOT NULL
    `
  );
  const fallbackContactTypeId = Number(contactTypeRows?.[0]?.ContactTypeId || 1);

  for (const contact of contacts) {
    await conn.query(
      `
      INSERT INTO ProjectContacts (ProjectId, ContactName, Title, Email, Phone, ContactTypeId)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        projectId,
        contact.contactName,
        contact.title || null,
        contact.email || null,
        contact.phone || null,
        fallbackContactTypeId,
      ]
    );
  }
}

async function replaceProjectResources(
  conn: any,
  projectId: number,
  resources: Array<{
    employeeId: string | null;
    resourceName: string;
    title: string | null;
    startDate: string | null;
    endDate: string | null;
    reportingManager: string | null;
    reportingManagerTitle: string | null;
  }>
) {
  await conn.query(`DELETE FROM ProjectResources WHERE ProjectId = ?`, [projectId]);

  for (const resource of resources) {
    const serializedResource = serializeProjectResource(resource);
    await conn.query(
      `
      INSERT INTO ProjectResources (
        ProjectId,
        EmployeeId,
        Title,
        ReportingManager,
        ReportingManagerTitle,
        StartDate,
        EndDate
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        projectId,
        serializedResource,
        resource.title || null,
        resource.reportingManager || null,
        resource.reportingManagerTitle || null,
        resource.startDate || null,
        resource.endDate || null,
      ]
    );
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { leadID: string } }
) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const leadId = Number(params.leadID);
    const { searchParams } = new URL(req.url);
    const projectIdParam = searchParams.get("projectId");
    const employeeSearchParam = searchParams.get("employeeSearch");
    const projectId = projectIdParam ? Number(projectIdParam) : null;
    const statusParam = (searchParams.get("status") || "all").toLowerCase();
    const includeHidden = searchParams.get("includeHidden") === "true";

    if (isNaN(leadId)) {
      return NextResponse.json({ error: "Invalid LeadId" }, { status: 400 });
    }

    if (projectIdParam && (projectId === null || isNaN(projectId))) {
      return NextResponse.json({ error: "Invalid ProjectId" }, { status: 400 });
    }

    const pool = await getPool();
    const conn = await pool.getConnection();

    try {
      if (typeof employeeSearchParam === "string") {
        const keyword = employeeSearchParam.trim();
        if (!keyword) {
          return NextResponse.json([]);
        }

        try {
          const [employees]: any = await conn.query(
            `
            SELECT
              CAST(e.employee_id AS CHAR(100)) AS EmployeeId,
              TRIM(e.name) AS EmployeeName
            FROM l_db.employee e
            WHERE COALESCE(TRIM(e.name), '') <> ''
              AND (
                LOWER(TRIM(e.name)) LIKE LOWER(?)
                OR CAST(e.employee_id AS CHAR(100)) LIKE ?
              )
            ORDER BY TRIM(e.name) ASC
            LIMIT 20
            `,
            [`%${keyword}%`, `%${keyword}%`]
          );

          return NextResponse.json(
            (employees || []).map((row: any) => ({
              EmployeeId: row.EmployeeId,
              EmployeeName: row.EmployeeName,
            }))
          );
        } catch (searchError: any) {
          console.error("Employee lookup failed:", searchError?.message || searchError);
          return NextResponse.json([]);
        }
      }

      const query = `
        SELECT DISTINCT
          p.ProjectId,
          p.ProjectCode,
          p.ProjectName,
          p.ProjectDesc,
          p.TechStack,
          p.KeyWork,
          p.ValueAdded,
          p.Deliverables,
          p.Challenges,
          p.StartDate,
          p.EndDate,
          CASE WHEN COALESCE(p.IsHidden, 0) = 1 THEN 'Hidden' ELSE 'Active' END AS Status
        FROM Projects p
        WHERE p.CustomerId = ?
          AND COALESCE(p.IsDeleted, 0) = 0
        ${!projectId && !includeHidden && statusParam === "all" ? "AND COALESCE(p.IsHidden, 0) = 0" : ""}
        ${!projectId && statusParam === "active" ? "AND COALESCE(p.IsHidden, 0) = 0" : ""}
        ${!projectId && statusParam === "hidden" ? "AND COALESCE(p.IsHidden, 0) = 1" : ""}
        ${projectId ? "AND p.ProjectId = ?" : ""}
        ORDER BY p.ProjectName ASC
      `;

      const queryParams = projectId ? [leadId, projectId] : [leadId];
      const [projects]: any = await conn.query(query, queryParams);

      if (projectId) {
        const project = projects?.[0] ?? null;

        if (!project) {
          return NextResponse.json(null);
        }

        let teamMembers: any[] = [];
        try {
          const [members]: any = await conn.query(
            `
            SELECT DISTINCT
              pr.EmployeeId AS EmployeeId,
              COALESCE(NULLIF(TRIM(e.name), ''), pr.EmployeeId) AS EmployeeName,
              pr.Title AS Title,
              pr.ReportingManager AS ReportingManager,
              pr.ReportingManagerTitle AS ReportingManagerTitle,
              pr.StartDate AS StartDate,
              pr.EndDate AS EndDate
            FROM ProjectResources pr
            INNER JOIN Projects p
              ON p.ProjectId = pr.ProjectId
            LEFT JOIN l_db.employee e
              ON TRIM(LOWER(CAST(e.employee_id AS CHAR(100)))) = TRIM(LOWER(CAST(pr.EmployeeId AS CHAR(100))))
            WHERE p.CustomerId = ?
              AND COALESCE(p.IsDeleted, 0) = 0
              AND pr.ProjectId = ?
            ORDER BY COALESCE(NULLIF(TRIM(e.name), ''), pr.EmployeeId) ASC
            `,
            [leadId, projectId]
          );
          teamMembers = Array.isArray(members) ? members : [];
        } catch (teamError: any) {
          console.error("Team members query failed, falling back to EmployeeId only:", {
            message: teamError?.message,
            code: teamError?.code,
            errno: teamError?.errno,
            sqlState: teamError?.sqlState,
          });

          const [fallbackMembers]: any = await conn.query(
            `
            SELECT DISTINCT
              pr.EmployeeId AS EmployeeId,
              pr.EmployeeId AS EmployeeName,
              pr.Title AS Title,
              pr.ReportingManager AS ReportingManager,
              pr.ReportingManagerTitle AS ReportingManagerTitle,
              pr.StartDate AS StartDate,
              pr.EndDate AS EndDate
            FROM ProjectResources pr
            INNER JOIN Projects p
              ON p.ProjectId = pr.ProjectId
            WHERE p.CustomerId = ?
              AND COALESCE(p.IsDeleted, 0) = 0
              AND pr.ProjectId = ?
            ORDER BY pr.EmployeeId ASC
            `,
            [leadId, projectId]
          );

          teamMembers = Array.isArray(fallbackMembers) ? fallbackMembers : [];
        }

        const normalizedTeamMembers = (Array.isArray(teamMembers) ? teamMembers : [])
          .map((member: any) => {
            const parsed = parseStoredProjectResource(member?.EmployeeId, member?.EmployeeName);
            return {
              EmployeeId: parsed.employeeId,
              EmployeeName: parsed.employeeName,
              Title: member?.Title ?? parsed.title,
              StartDate: member?.StartDate ?? parsed.startDate,
              EndDate: member?.EndDate ?? parsed.endDate,
              ReportingManager: member?.ReportingManager ?? parsed.reportingManager,
              ReportingManagerTitle:
                member?.ReportingManagerTitle ?? parsed.reportingManagerTitle,
            };
          })
          .filter((member: any) => hasValue(member.EmployeeName));

        const [projectContacts]: any = await conn.query(
          `
          SELECT
            pc.ContactId,
            pc.ProjectId,
            pc.ContactName,
            pc.Title,
            pc.Email,
            pc.Phone,
            pc.ContactTypeId
          FROM ProjectContacts pc
          INNER JOIN Projects p
            ON p.ProjectId = pc.ProjectId
          WHERE p.CustomerId = ?
            AND COALESCE(p.IsDeleted, 0) = 0
            AND pc.ProjectId = ?
          ORDER BY pc.ContactName ASC
          `,
          [leadId, projectId]
        );

        const normalizedProjectContacts = (Array.isArray(projectContacts) ? projectContacts : [])
          .map((contact: any) => {
            const parsed = parseStoredProjectContact(contact?.ContactName);
            const rawContactName = String(contact?.ContactName ?? "").trim();
            const isLegacyEncodedContactName = rawContactName.startsWith(JSON_PREFIX);
            return {
              ...contact,
              ContactName: isLegacyEncodedContactName
                ? parsed.contactName
                : hasValue(contact?.ContactName)
                  ? rawContactName
                : parsed.contactName,
              Title: hasValue(contact?.Title)
                ? String(contact.Title).trim()
                : parsed.title,
              Email: hasValue(contact?.Email)
                ? String(contact.Email).trim()
                : parsed.email,
              Phone: hasValue(contact?.Phone)
                ? String(contact.Phone).trim()
                : parsed.phone,
            };
          })
          .filter((contact: any) => hasValue(contact.ContactName));

        return NextResponse.json({
          ...project,
          TeamMembers: normalizedTeamMembers,
          ProjectContacts: normalizedProjectContacts,
        });
      }

      return NextResponse.json(projects);
    } finally {
      conn.release();
    }
  } catch (error: any) {
    console.error("Error fetching projects:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch projects" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { leadID: string } }
) {
  let conn: any;
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const leadId = Number(params.leadID);
    if (isNaN(leadId)) {
      return NextResponse.json({ error: "Invalid LeadId" }, { status: 400 });
    }

    const body = await req.json();
    const {
      ProjectCode,
      ProjectName,
      ProjectDesc,
      TechStack,
      KeyWork,
      ValueAdded,
      Deliverables,
      Challenges,
      StartDate,
      EndDate,
      ProjectContacts,
      ProjectResources,
    } = body || {};

    const normalizedContacts = normalizeProjectContacts(ProjectContacts);
    const normalizedResources = normalizeProjectResources(ProjectResources);

    if (!ProjectName || !String(ProjectName).trim()) {
      return NextResponse.json({ error: "Project Name is required" }, { status: 400 });
    }

    const pool = await getPool();
    conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const customerId = leadId;

      const [inserted]: any = await conn.query(
        `
        INSERT INTO projects
          (ProjectCode, ProjectName, ProjectDesc, TechStack, KeyWork, ValueAdded, Deliverables, Challenges, StartDate, EndDate, CustomerId, IsHidden)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        `,
        [
          ProjectCode ?? null,
          String(ProjectName).trim(),
          ProjectDesc ?? null,
          TechStack ?? null,
          KeyWork ?? null,
          ValueAdded ?? null,
          Deliverables ?? null,
          Challenges ?? null,
          StartDate || null,
          EndDate || null,
          customerId,
        ]
      );

      const [rows]: any = await conn.query(
        `
        SELECT
          ProjectId,
          ProjectCode,
          ProjectName,
          ProjectDesc,
          TechStack,
          KeyWork,
          ValueAdded,
          Deliverables,
          Challenges,
          StartDate,
          EndDate,
          CASE WHEN COALESCE(IsHidden, 0) = 1 THEN 'Hidden' ELSE 'Active' END AS Status
        FROM projects
        WHERE ProjectId = ?
        `,
        [inserted.insertId]
      );

      await replaceProjectContacts(conn, inserted.insertId, normalizedContacts);
      await replaceProjectResources(conn, inserted.insertId, normalizedResources);

      await conn.commit();

      return NextResponse.json(rows?.[0] ?? null, { status: 201 });
    } finally {
      if (conn) conn.release();
    }
  } catch (error: any) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {}
    }
    console.error("Error creating project:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create project" },
      { status: 500 }
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { leadID: string } }
) {
  let conn: any;
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const leadId = Number(params.leadID);
    if (isNaN(leadId)) {
      return NextResponse.json({ error: "Invalid LeadId" }, { status: 400 });
    }

    const body = await req.json();
    const {
      ProjectId,
      ProjectCode,
      ProjectName,
      ProjectDesc,
      TechStack,
      KeyWork,
      ValueAdded,
      Deliverables,
      Challenges,
      StartDate,
      EndDate,
      IsHidden,
      ProjectContacts,
      ProjectResources,
    } = body || {};

    const normalizedContacts = normalizeProjectContacts(ProjectContacts);
    const normalizedResources = normalizeProjectResources(ProjectResources);

    const projectId = Number(ProjectId);
    if (isNaN(projectId)) {
      return NextResponse.json({ error: "Invalid ProjectId" }, { status: 400 });
    }

    const pool = await getPool();
    conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `
        UPDATE projects p
        SET
          p.ProjectCode = COALESCE(?, p.ProjectCode),
          p.ProjectName = COALESCE(?, p.ProjectName),
          p.ProjectDesc = COALESCE(?, p.ProjectDesc),
          p.TechStack = COALESCE(?, p.TechStack),
          p.KeyWork = COALESCE(?, p.KeyWork),
          p.ValueAdded = COALESCE(?, p.ValueAdded),
          p.Deliverables = COALESCE(?, p.Deliverables),
          p.Challenges = COALESCE(?, p.Challenges),
          p.StartDate = COALESCE(?, p.StartDate),
          p.EndDate = COALESCE(?, p.EndDate),
          p.IsHidden = COALESCE(?, p.IsHidden)
        WHERE p.ProjectId = ?
          AND p.CustomerId = ?
        `,
        [
          ProjectCode ?? null,
          ProjectName ? String(ProjectName).trim() : null,
          ProjectDesc ?? null,
          TechStack ?? null,
          KeyWork ?? null,
          ValueAdded ?? null,
          Deliverables ?? null,
          Challenges ?? null,
          StartDate || null,
          EndDate || null,
          typeof IsHidden === "boolean" || typeof IsHidden === "number"
            ? Number(Boolean(IsHidden))
            : null,
          projectId,
          leadId,
        ]
      );

      const [rows]: any = await conn.query(
        `
        SELECT
          ProjectId,
          ProjectCode,
          ProjectName,
          ProjectDesc,
          TechStack,
          KeyWork,
          ValueAdded,
          Deliverables,
          Challenges,
          StartDate,
          EndDate,
          CASE WHEN COALESCE(IsHidden, 0) = 1 THEN 'Hidden' ELSE 'Active' END AS Status
        FROM projects
        WHERE ProjectId = ?
        `,
        [projectId]
      );

      await replaceProjectContacts(conn, projectId, normalizedContacts);
      await replaceProjectResources(conn, projectId, normalizedResources);

      await conn.commit();

      return NextResponse.json(rows?.[0] ?? null);
    } finally {
      if (conn) conn.release();
    }
  } catch (error: any) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {}
    }
    console.error("Error updating project:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update project" },
      { status: 500 }
    );
  }
}
