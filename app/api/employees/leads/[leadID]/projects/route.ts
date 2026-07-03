import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import { getAuthUser } from "../../../../lib/auth";

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

        const [teamMembers]: any = await conn.query(
          `
          SELECT DISTINCT
            pr.EmployeeId AS EmployeeId,
            COALESCE(e.name, pr.EmployeeId) AS EmployeeName
          FROM ProjectResources pr
          INNER JOIN Projects p
            ON p.ProjectId = pr.ProjectId
          LEFT JOIN aaram_db.employee e
            ON e.employee_id = pr.EmployeeId
           AND e.active = 1
          WHERE p.CustomerId = ?
            AND pr.ProjectId = ?
          ORDER BY COALESCE(e.name, pr.EmployeeId) ASC
          `,
          [leadId, projectId]
        );

        const [projectContacts]: any = await conn.query(
          `
          SELECT
            pc.ContactId,
            pc.ProjectId,
            pc.ContactName,
            pc.ContactTypeId
          FROM ProjectContacts pc
          INNER JOIN Projects p
            ON p.ProjectId = pc.ProjectId
          WHERE p.CustomerId = ?
            AND pc.ProjectId = ?
          ORDER BY pc.ContactName ASC
          `,
          [leadId, projectId]
        );

        return NextResponse.json({
          ...project,
          TeamMembers: Array.isArray(teamMembers) ? teamMembers : [],
          ProjectContacts: Array.isArray(projectContacts) ? projectContacts : [],
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
    } = body || {};

    if (!ProjectName || !String(ProjectName).trim()) {
      return NextResponse.json({ error: "Project Name is required" }, { status: 400 });
    }

    const pool = await getPool();
    const conn = await pool.getConnection();
    try {
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

      return NextResponse.json(rows?.[0] ?? null, { status: 201 });
    } finally {
      conn.release();
    }
  } catch (error: any) {
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
    } = body || {};

    const projectId = Number(ProjectId);
    if (isNaN(projectId)) {
      return NextResponse.json({ error: "Invalid ProjectId" }, { status: 400 });
    }

    const pool = await getPool();
    const conn = await pool.getConnection();
    try {
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

      return NextResponse.json(rows?.[0] ?? null);
    } finally {
      conn.release();
    }
  } catch (error: any) {
    console.error("Error updating project:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update project" },
      { status: 500 }
    );
  }
}
