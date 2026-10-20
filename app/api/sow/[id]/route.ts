import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";
import { getAuthUser } from "@/app/api/lib/auth";
import { CompanyRequiredError, requireCompanyId } from "@/app/api/lib/company-tenancy";

async function getTableColumns(pool: any, tableName: string): Promise<Set<string>> {
  const [rows]: any = await pool.query(
    `
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
    `,
    [tableName]
  );
  return new Set((rows || []).map((r: any) => String(r.COLUMN_NAME)));
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const companyId = requireCompanyId(authUser);

    const projectId = Number(params.id);
    if (!projectId || Number.isNaN(projectId)) {
      return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
    }

    const pool = await getPool();
    const masterCols = await getTableColumns(pool, "SOWMaster");
    const has = (name: string) => masterCols.has(name);
    const fileNameSelect = has("FileName")
      ? "s.FileName"
      : has("SOWFileName")
        ? "s.SOWFileName AS FileName"
        : "NULL AS FileName";
    const [rows]: any = await pool.query(
      `
      SELECT
        s.SOWId,
        ${has("ProjectId") ? "s.ProjectId" : "NULL AS ProjectId"},
        ${has("SOWName") ? "s.SOWName" : "NULL AS SOWName"},
        ${has("Client") ? "s.Client" : "NULL AS Client"},
        ${fileNameSelect},
        ${has("EffectiveDate") ? "s.EffectiveDate" : "NULL AS EffectiveDate"},
        ${has("StartDate") ? "s.StartDate" : "NULL AS StartDate"},
        ${has("EndDate") ? "s.EndDate" : "NULL AS EndDate"},
        ${has("NumberOfPositions") ? "s.NumberOfPositions" : "NULL AS NumberOfPositions"},
        ${has("NumberOfResources") ? "s.NumberOfResources" : "NULL AS NumberOfResources"},
        ${has("UploadedOn") ? "s.UploadedOn" : "NULL AS UploadedOn"},
        ${has("ParseStatus") ? "s.ParseStatus" : "NULL AS ParseStatus"},
        ${has("ParseMessage") ? "s.ParseMessage" : "NULL AS ParseMessage"},
        ${has("VersionNo") ? "s.VersionNo" : "1 AS VersionNo"},
        ${has("Status") ? "s.Status" : "NULL AS Status"}
      FROM SOWMaster s
      INNER JOIN Projects p
        ON p.ProjectId = s.ProjectId
       AND p.CompanyId = ?
      WHERE s.ProjectId = ?
        ${has("CompanyId") ? "AND s.CompanyId = ?" : ""}
        ${has("IsActive") ? "AND s.IsActive = 1" : ""}
        ${has("IsCurrent") ? "AND s.IsCurrent = 1" : ""}
      ORDER BY ${has("VersionNo") ? "s.VersionNo DESC" : "s.SOWId DESC"}
      LIMIT 1
      `,
      has("CompanyId") ? [companyId, projectId, companyId] : [companyId, projectId]
    );

    if (!rows?.length) {
      return NextResponse.json({ exists: false, sow: null });
    }

    const sow = rows[0];
    return NextResponse.json({
      exists: true,
      sow: {
        SOWId: sow.SOWId,
        ProjectId: sow.ProjectId,
        SOWName: sow.SOWName,
        Client: sow.Client,
        FileName: sow.FileName,
        EffectiveDate: sow.EffectiveDate,
        StartDate: sow.StartDate,
        EndDate: sow.EndDate,
        NumberOfPositions: Number(sow.NumberOfPositions || 0),
        NumberOfResources: Number(sow.NumberOfResources || 0),
        UploadedOn: sow.UploadedOn,
        ParseStatus: sow.ParseStatus,
        ParseMessage: sow.ParseMessage,
        VersionNo: Number(sow.VersionNo || 1),
        Status: sow.Status || "Active",
      },
    });
  } catch (error: any) {
    if (error instanceof CompanyRequiredError) {
      return NextResponse.json({ error: "Company membership required" }, { status: 403 });
    }
    return NextResponse.json({ error: error?.message || "Failed to fetch SOW" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const companyId = requireCompanyId(authUser);

    const sowId = Number(params.id);
    if (!sowId || Number.isNaN(sowId)) {
      return NextResponse.json({ error: "Invalid sowId" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const status = body?.Status ? String(body.Status).trim() : null;
    const isActive =
      typeof body?.IsActive === "boolean" || typeof body?.IsActive === "number"
        ? Number(Boolean(body.IsActive))
        : null;

    if (status === null && isActive === null) {
      return NextResponse.json(
        { error: "Provide at least one field to update: Status or IsActive" },
        { status: 400 }
      );
    }

    const pool = await getPool();
    await pool.query(
      `
      UPDATE SOWMaster
      SET Status = COALESCE(?, Status),
          IsActive = COALESCE(?, IsActive)
      WHERE SOWId = ?
        AND CompanyId = ?
      `,
      [status, isActive, sowId, companyId]
    );

    const [rows]: any = await pool.query(
      `
      SELECT
        SOWId,
        ProjectId,
        SOWName,
        Client,
        FileName,
        EffectiveDate,
        StartDate,
        EndDate,
        NumberOfPositions,
        NumberOfResources,
        UploadedOn,
        ParseStatus,
        ParseMessage,
        VersionNo,
        Status,
        IsActive
      FROM SOWMaster
      WHERE SOWId = ?
        AND CompanyId = ?
      LIMIT 1
      `,
      [sowId, companyId]
    );

    return NextResponse.json(rows?.[0] || null);
  } catch (error: any) {
    if (error instanceof CompanyRequiredError) {
      return NextResponse.json({ error: "Company membership required" }, { status: 403 });
    }
    return NextResponse.json({ error: error?.message || "Failed to update SOW" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  let conn: any;
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const companyId = requireCompanyId(authUser);

    const sowId = Number(params.id);
    if (!sowId || Number.isNaN(sowId)) {
      return NextResponse.json({ error: "Invalid sowId" }, { status: 400 });
    }

    const pool = await getPool();
    conn = await pool.getConnection();

    await conn.beginTransaction();

    const [targetRows]: any = await conn.query(
      `SELECT SOWId, ProjectId, IsCurrent, VersionNo FROM SOWMaster WHERE SOWId = ? AND CompanyId = ? LIMIT 1`,
      [sowId, companyId]
    );
    const target = targetRows?.[0];
    if (!target) {
      await conn.rollback();
      return NextResponse.json({ error: "SOW not found" }, { status: 404 });
    }

    await conn.query(
      `
      UPDATE SOWMaster
      SET IsActive = 0,
          IsCurrent = 0,
          Status = 'Deleted'
      WHERE SOWId = ?
        AND CompanyId = ?
      `,
      [sowId, companyId]
    );

    if (Number(target.IsCurrent || 0) === 1) {
      const [fallbackRows]: any = await conn.query(
        `
        SELECT SOWId
        FROM SOWMaster
        WHERE ProjectId = ?
          AND CompanyId = ?
          AND IsActive = 1
          AND SOWId <> ?
        ORDER BY VersionNo DESC
        LIMIT 1
        `,
        [target.ProjectId, companyId, sowId]
      );
      const fallback = fallbackRows?.[0];
      if (fallback?.SOWId) {
        await conn.query(
          `UPDATE SOWMaster SET IsCurrent = 1, Status = 'Active' WHERE SOWId = ? AND CompanyId = ?`,
          [fallback.SOWId, companyId]
        );
      }
    }

    await conn.commit();
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (conn) {
      try {
        await conn.rollback();
      } catch {}
    }
    if (error instanceof CompanyRequiredError) {
      return NextResponse.json({ error: "Company membership required" }, { status: 403 });
    }
    return NextResponse.json({ error: error?.message || "Failed to delete SOW" }, { status: 500 });
  } finally {
    if (conn) conn.release();
  }
}

